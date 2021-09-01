#! /usr/local/bin/node
/*jslint node:true, esversion:9 */
// listProxyBasepaths.js
// ------------------------------------------------------------------
//
// Copyright 2018-2021 Google LLC.
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
// created: Mon Mar 20 09:57:02 2017
// last saved: <2021-September-01 12:54:55>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      util     = require('util'),
      sprintf  = require('sprintf-js').sprintf,
      AdmZip   = require('adm-zip'),
      DOM      = require('@xmldom/xmldom').DOMParser,
      xpath    = require('xpath'),
      Getopt   = require('node-getopt'),
      version  = '20210901-1254',
      getopt   = new Getopt(common.commonOptions.concat([
        ['' , 'proxypattern=ARG', 'Optional. a regular expression. Look only in proxies that match this regexp.'],
        ['' , 'latestrevision', 'Optional. only look in the latest revision number for each proxy.']
      ])).bindHelp();

function isKeeper(opt) {
  if (opt.options.proxypattern) {
    if (opt.options.verbose) {
      common.logWrite('using regex match (%s)',opt.options.proxypattern);
    }
    return name => name.match(new RegExp(opt.options.proxypattern));
  }
  return () => true;
}

const revisionMapper = (org, name) =>
  revision =>
  org.proxies.export({ name, revision })
  .then( result => {
    let zip = new AdmZip(result.buffer),
        re1 = new RegExp('^apiproxy/proxies/[^/]+.xml$');
    return zip
      .getEntries()
      .filter( entry => entry.entryName.match(re1))
      .map( entry => {
        let data = entry.getData().toString('utf8'),
            doc = new DOM().parseFromString(data),
            endpointName = xpath.select('/ProxyEndpoint/@name', doc)[0].value,
            nodeset = xpath.select('/ProxyEndpoint/HTTPProxyConnection/BasePath', doc),
            theNode = nodeset && nodeset[0],
            firstChild = theNode && theNode.firstChild,
            basePath = firstChild && firstChild.data;
        return {
          name: endpointName,
          basePath: basePath || 'unknown',
          adminPath: sprintf('apis/%s/revisions/%s/endpoints/%s', name, revision, endpointName)
        };
      });
  });

const revisionReducer = fn =>
 (p, revision) =>
    p.then( accumulator =>
            fn(revision)
            .then( endpoint => [...accumulator, { revision, endpoint }]));


const toRevisions = org =>
 (promise, name) =>
    promise .then( accumulator =>
                   org.proxies.get({ name })
                   .then( ({revision}) => {
                     if (opt.options.latestrevision) {
                       revision = [revision.pop()];
                     }
                     return [ ...accumulator, {name, revision} ];
                   }));


// ========================================================
// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee listProxiesByBasepath.js tool, version: ${version}\n` +
      `Node.js ${process.version}\n`);

  common.logWrite('start');
}

common.verifyCommonRequiredParameters(opt.options, getopt);

apigee
  .connect(common.optToOptions(opt))
  .then(org =>
    org.proxies.get()
        .then( apiproxies => {
          // for gaambo
          if (Array.isArray(apiproxies.proxies)) {
            apiproxies = apiproxies.proxies.map(p => p.name);
          }
        if (opt.options.verbose) {
          common.logWrite('total count of API proxies for that org: %d', apiproxies.length);
        }
        return apiproxies
          .filter( isKeeper(opt) )
          .sort()
          .reduce( toRevisions(org), Promise.resolve([]));
        })
        .then( candidates => {
        let r = (p, nameAndRevisions) =>
          p.then( accumulator => {
            let mapper = revisionMapper(org, nameAndRevisions.name);
            return nameAndRevisions.revision
              .reduce(revisionReducer(mapper), Promise.resolve([]))
              .then( a => [...accumulator, {proxyname: nameAndRevisions.name, found:a}]);
        });
        return candidates.reduce(r, Promise.resolve([]));
      })
  )

  .then( r => console.log('' + JSON.stringify(r, null, 2)) )

  .catch( e => console.log('while executing, error: ' + e.stack) );
