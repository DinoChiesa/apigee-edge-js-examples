#! /usr/local/bin/node
/*jslint node:true */
// listProxyPolicies.js
// ------------------------------------------------------------------
// list proxies and their policies in Apigee
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
// last saved: <2022-August-29 17:04:12>

const apigeejs   = require('apigee-edge-js'),
      util       = require('util'),
      common     = apigeejs.utility,
      apigee     = apigeejs.apigee,
      sprintf    = require('sprintf-js').sprintf,
      tmp        = require('tmp-promise'),
      fs         = require('fs'),
      path       = require('path'),
      AdmZip     = require('adm-zip'),
      Getopt     = require('node-getopt'),
      version    = '20220829-1546',
      getopt     = new Getopt(common.commonOptions.concat([
        ['' , 'regexp=ARG', 'Optional. check only for proxies with names that match this regexp.'],
        ['' , 'latestrevision', 'Optional. inquire only the latest revision of each proxy.'],
      ])).bindHelp();


function isKeeper(opt) {
  if (opt.options.regexp) {
    common.logWrite('using regex match (%s)', opt.options.regexp);
    return name => name.match(new RegExp(opt.options.regexp));
  }
  return () => true;
}

// ========================================================

console.log(
  `Apigee List Proxies and policies tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));
common.verifyCommonRequiredParameters(opt.options, getopt);

apigee.connect(common.optToOptions(opt))
  .then(org =>
        tmp.dir({unsafeCleanup:true, prefix: 'listProxyPolicies'})
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
                // check to only the most recent revision), and then query the
                // policies in those revisions.
                return proxies
                  .sort()
                  .filter( isKeeper(opt) )
                  .reduce(reducer, Promise.resolve([]))
                  .then( proxiesAndRevisions => {

                    function getRevisionPolicyLister(name) {
                      return revision =>
                      exportOneProxyRevision(name, revision)
                        .then(pathOfZip => {
                          let zip = new AdmZip(pathOfZip);
                          let pathOfUnzippedBundle = path.join(tmpdir.path, `proxy-${name}-r${revision}`);
                          zip.extractAllTo(pathOfUnzippedBundle, false);
                          let policiesDir = path.join(pathOfUnzippedBundle,'apiproxy','policies');
                          return fs.existsSync(policiesDir) ? fs.readdirSync(policiesDir) : [];
                        });
                    }

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

                    let fn2 = (proxyName) => {
                          let listPolicies = getRevisionPolicyLister(proxyName);
                          return (p, revision) =>
                          p.then( accumulator =>
                                  listPolicies(revision)
                                  .then( policies => [...accumulator, {revision, policies}] ));
                        };

                    let fn1 = (p, nameAndRevisions) =>
                    p.then( acc =>
                            nameAndRevisions.revision.reduce(fn2(nameAndRevisions.proxyname), Promise.resolve([]))
                            .then( a => [...acc, {proxyname: nameAndRevisions.proxyname, analysis:a}]) );

                    return proxiesAndRevisions.reduce(fn1, Promise.resolve([]));
                  });
              })))

  .then(results => console.log('results: ' + JSON.stringify(results, null, 2)))
  .catch( e => console.error('error: ' + util.format(e) ) );
