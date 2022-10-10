#! /usr/local/bin/node
/*jslint node:true */
// findFlowCallouts.js
// ------------------------------------------------------------------
// In an Apigee organization, find all proxies that include a FlowCallout,
// and optionally a callout to a specific (named) sharedflow.  This uses a
// brute-force client-side search, so it will take a while to run on an org that
// has many proxy revisions.
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
// last saved: <2022-October-10 13:39:27>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      sprintf  = require('sprintf-js').sprintf,
      AdmZip   = require('adm-zip'),
      Dom      = require("@xmldom/xmldom").DOMParser,
      path     = require('path'),
      fs       = require('fs'),
      tmp      = require('tmp-promise'),
      util     = require('util'),
      Getopt   = require('node-getopt'),
      version  = '20221010-1235',
      getopt   = new Getopt(common.commonOptions.concat([
        ['F' , 'sharedflow=ARG', 'Optional. find only FlowCallouts referencing a specific Sharedflow.'],
        ['L' , 'list', 'Optional. don\'t find. just list the SharedFlows in the org.'],
        ['' , 'proxyregexp=ARG', 'Optional. check only for proxies with names that match this regexp.'],
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

process.on('unhandledRejection',
            r => console.log('\n*** unhandled promise rejection: ' + util.format(r)));
let opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee FlowCallout check tool, version: ${version}\n` +
      `Node.js ${process.version}\n`);

  common.logWrite('start');
}

const policyUrl = (proxyName, revision, policyName) =>
 sprintf("/v1/organizations/%s/apis/%s/revisions/%s/policies/%s",
                 opt.options.org, proxyName, revision, policyName);

common.verifyCommonRequiredParameters(opt.options, getopt);

apigee.connect(common.optToOptions(opt))
  .then( org => {
    if (opt.options.verbose) {
      common.logWrite('connected');
    }
    if (opt.options.list) {
      return org.sharedflows.get({})
        .then( result => {
          if (result.sharedFlows) { result = result.sharedFlows.map(x => x.name ); } // GAAMBO
          return `found ${result.length} sharedflows: ` + result.join(', ');
        });
    }

    return tmp.dir({unsafeCleanup:true, prefix: 'findFlowCallouts'})
      .then (tmpdir => {
        return org.proxies.get({})
             .then(resp => {
               let isGaambo = !!resp.proxies;
               let proxies = (isGaambo) ? resp.proxies.map(p => p.name) : resp;
               if (opt.options.verbose) {
                 common.logWrite(sprintf('found %d proxies', proxies.length));
               }
               return proxies;
             })
             .then(proxies => {
               let reducer = (p, proxyname) =>
               p.then( a =>
                       org.proxies.get({ name: proxyname })
                       .then( ({revision}) => {
                         if (opt.options.latestrevision) {
                           revision = [revision.pop()];
                         }
                         return [ ...a, {proxyname, revision} ];
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

                   const exportOneProxyRevision = (name, revision) =>
                   org.proxies.export({name, revision})
                     .then( result => {
                       let pathOfZip = path.join(tmpdir.path, result.filename);
                       fs.writeFileSync(pathOfZip, result.buffer);
                       if (opt.options.verbose) {
                         common.logWrite('export ok file: %s', pathOfZip);
                       }
                       return pathOfZip;
                     });

                   const unzipRevision = (name, revision) =>
                   exportOneProxyRevision(name, revision)
                     .then(pathOfZip => {
                       let zip = new AdmZip(pathOfZip);
                       let pathOfUnzippedBundle = path.join(tmpdir.path, `proxy-${name}-r${revision}`);
                       zip.extractAllTo(pathOfUnzippedBundle, false);
                       return pathOfUnzippedBundle;
                     });


                   const checkRevisionForFlowCallout = proxyName => revision =>
                   unzipRevision(proxyName, revision)
                     .then (pathOfUnzippedBundle => {
                       let policiesDir = path.join(pathOfUnzippedBundle, 'apiproxy', 'policies');
                       if ( ! fs.existsSync(policiesDir)) {
                         return [];
                       }
                       let result = fs.readdirSync(policiesDir)
                         .filter( name => {
                           let element = new Dom().parseFromString(fs.readFileSync(path.join(policiesDir, name), 'utf-8'));
                           let cond = element.documentElement.tagName == 'FlowCallout';
                           if (cond && opt.options.sharedflow) {
                             // only a PARTICULAR sharedflow
                             let elt = element.documentElement;
                             let ix =
                             Object.keys(elt.childNodes)
                               .filter(key => key!='length')
                               .map(key => Number(key))
                               .reduce( (acc,num) =>
                                        ((elt.childNodes[num].tagName=='SharedFlowBundle') ? num : acc), -1);

                             cond = (ix>=0) &&
                               elt.childNodes[ix].firstChild.data == opt.options.sharedflow;
                           }
                           return cond;
                         })
                       ;
                       return result;
                     });


                   let fn2 = (proxyName) => {
                         let check = checkRevisionForFlowCallout(proxyName);
                         return (p, revision) =>
                         p.then( accumulator =>
                                 check(revision)
                                 .then( result => [...accumulator, { revision, policies: result }] ));
                       };

                   let fn1 = (p, nameAndRevisions) =>
                   p.then( acc =>
                           nameAndRevisions.revision.reduce(fn2(nameAndRevisions.proxyname), Promise.resolve([]))
                           .then( a => [...acc, {proxyname: nameAndRevisions.proxyname, found:a}]) );

                   //console.log(JSON.stringify(proxiesAndRevisions, null, 2));
                   return proxiesAndRevisions.reduce(fn1, Promise.resolve([]));
                 });
             });
      });
  })

  .then( r => {
    if (typeof r == 'string') {
      console.log(r);
    }
    else {
      // filter out those with zero FlowCallouts
      r = r.filter(entry => entry.found.find(item => item.policies.length != 0));
      console.log('' + JSON.stringify(r, null, 2));
    }
  })

  .catch( e => console.log('while executing, error: ' + util.format(e)) );
