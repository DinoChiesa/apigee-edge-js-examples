#! /usr/local/bin/node
/*jslint node:true, esversion:9 */
// findJavaPolicies.js
// ------------------------------------------------------------------
// In Apigee, find all JavaCallout policies in all proxies.
// Or, alternatively, find proxies in an org that have a JavaCallout that references a specific JAR as a resource.
//
//
// This tool does not examine environment-wide or organization-wide resources,
// which can be "implicitly" referenced.
//
// Copyright 2017-2022 Google LLC.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// last saved: <2022-August-29 17:23:26>

const apigeejs = require('apigee-edge-js'),
      sprintf    = require('sprintf-js').sprintf,
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      tmp        = require('tmp-promise'),
      fs         = require('fs'),
      path       = require('path'),
      AdmZip     = require('adm-zip'),
      Dom = require("@xmldom/xmldom").DOMParser,
      Getopt   = require('node-getopt'),
      util     = require('util'),
      version  = '20220829-1644',
      getopt   = new Getopt(common.commonOptions.concat([
        ['' , 'findJar=ARG', 'Optional. Find proxies that reference this particular JAR. Use exactly one of the --findXXX options.'],
        ['' , 'findJarRegexp=ARG', 'Optional. Find proxies that reference JAR files that match the regexp. Use exactly one of the --findXXX options.'],
        ['' , 'findJava', 'Optional. Find proxies that use any JavaCallout. Use exactly one of the --findXXX options.'],
        ['' , 'proxyregexp=ARG', 'Optional. check only for proxies that match this regexp.'],
        ['' , 'latestrevision', 'Optional. only look in the latest revision number for each proxy.']
      ])).bindHelp();

function isKeeper(opt) {
  if (opt.options.proxyregexp) {
    common.logWrite('using regex match (%s)', opt.options.proxyregexp);
    return name => name.match(new RegExp(opt.options.proxyregexp));
  }
  return () => true;
}


// ========================================================
// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee JavaCallout/JAR check tool, version: ${version}\n` +
      `Node.js ${process.version}\n`);

  common.logWrite('start');
}

if ((opt.options.findJar && opt.options.findJarRegexp) ||
    (opt.options.findJar && opt.options.findJava) ||
    (opt.options.findJarRegexp && opt.options.findJava)) {
  console.log('you must specify exactly one of the --find options');
  process.exit(1);
}

if ( ! opt.options.findJar && !opt.options.findJarRegexp && !opt.options.findJava) {
  console.log('you must specify one of the --find options');
  process.exit(1);
}

common.verifyCommonRequiredParameters(opt.options, getopt);
apigee
  .connect(common.optToOptions(opt))
  .then( org =>
        tmp.dir({unsafeCleanup:true, prefix: 'findJavaPolicies'})
        .then(tmpdir =>
          org.proxies.get({})
              .then(resp => {
                let isGaambo = !!resp.proxies;
                let proxies = (isGaambo) ? resp.proxies.map(p => p.name) : resp;
                common.logWrite(sprintf('found %d proxies', proxies.length));
                return proxies;
              })
          .then(proxies => {
            let reducer = (promise, proxyname) =>
              promise .then( accumulator =>
                             org.proxies.get({ name: proxyname })
                             .then( ({revision}) => {
                               if (opt.options.latestrevision) {
                                 revision = [revision.pop()];
                               }
                               return [ ...accumulator, {proxyname, revision} ];
                             }));

            // Starting from the list of proxies, filter to keep only those of
            // interest, then get the revisions of each one (maybe confining the
            // check to only the most recent revision), and then examine the
            // policies or resources in those revisions.
            return proxies
              .sort()
              .filter( isKeeper(opt) )
              .reduce(reducer, Promise.resolve([]))
              .then( proxiesAndRevisions => {
                //common.logWrite('checking...' + JSON.stringify(proxiesAndRevisions));

                function exportOneProxyRevision(name, revision) {
                  return org.proxies.export({name:name, revision:revision})
                    .then( result => {
                      let pathOfZip = path.join(tmpdir.path, result.filename);
                      fs.writeFileSync(pathOfZip, result.buffer);
                      if (opt.options.verbose) {
                        common.logWrite('export ok file: %s', pathOfZip);
                      }
                      return pathOfZip;
                    });
                }

                function unzipRevision(name, revision) {
                  return exportOneProxyRevision(name, revision)
                        .then(pathOfZip => {
                          let zip = new AdmZip(pathOfZip);
                          let pathOfUnzippedBundle = path.join(tmpdir.path, `proxy-${name}-r${revision}`);
                          zip.extractAllTo(pathOfUnzippedBundle, false);
                          return pathOfUnzippedBundle;
                        });
                }

                function checkRevisionForJar(proxyName) {
                  let regexp = (opt.options.findJarRegexp) ? new RegExp(opt.options.findJarRegexp) : null;
                  return revision =>
                  unzipRevision(proxyName, revision)
                    .then (pathOfUnzippedBundle => {
                      let resourcesDir = path.join(pathOfUnzippedBundle, 'apiproxy', 'resources', 'java');
                      if ( ! fs.existsSync(resourcesDir)) {
                        return [];
                      }

                      let result = fs.readdirSync(resourcesDir)
                        .filter( name => (regexp) ? regexp.test(name) : name == opt.options.jar);
                      return result;
                    });
                }

                function checkRevisionForJava(proxyName) {
                  return revision =>
                  unzipRevision(proxyName, revision)
                    .then (pathOfUnzippedBundle => {
                      let policiesDir = path.join(pathOfUnzippedBundle, 'apiproxy', 'policies');
                      if ( ! fs.existsSync(policiesDir)) {
                        return [];
                      }
                      let result = fs.readdirSync(policiesDir)
                        .filter( name => {
                          let element = new Dom().parseFromString(fs.readFileSync(path.join(policiesDir, name), 'utf-8'));
                          return element.documentElement.tagName == 'JavaCallout';
                        });
                      return result;
                    });
                }


                let getChecker = (opt.options.findJar || opt.options.findJarRegexp) ? checkRevisionForJar : checkRevisionForJava;

                let fn2 = (proxyName) => {
                  let check = getChecker(proxyName);
                  return (p, revision) =>
                    p.then( accumulator =>
                            check(revision)
                            .then( result => {
                              let obj= { revision };
                              if (opt.options.findJava) {
                                obj.policies = result;
                              }
                              else {
                                obj.resources = result;
                              }
                              return [...accumulator, obj];
                            }));
                    };

                let fn1 = (p, nameAndRevisions) =>
                  p.then( acc =>
                          nameAndRevisions.revision.reduce(fn2(nameAndRevisions.proxyname), Promise.resolve([]))
                          .then( a => [...acc, {proxyname: nameAndRevisions.proxyname, found:a}]) );

                return proxiesAndRevisions.reduce(fn1, Promise.resolve([]));
              });
          })))

  .then( r => {
    r = r.filter(entry => entry.found.find(item => item.policies.length != 0));
    console.log('' + JSON.stringify(r, null, 2));
  })

  .catch( e => console.log('while executing, error: ' + util.format(e)) );
