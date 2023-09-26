// findProxyWithTargetType.js
// ------------------------------------------------------------------
//
// Copyright 2018-2023 Google LLC.
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
// last saved: <2023-September-26 14:39:41>
/* global process */

const apigeejs     = require('apigee-edge-js'),
      common     = apigeejs.utility,
      apigee   = apigeejs.apigee,
      util       = require('util'),
      AdmZip   = require('adm-zip'),
      DOM      = require('@xmldom/xmldom').DOMParser,
      xpath    = require('xpath'),
      Getopt     = require('node-getopt'),
      version    = '20230925-0930',
      allowedTargetTypes = [ 'http', 'node', 'hosted'],
      getopt     = new Getopt(common.commonOptions.concat([
        ['R' , 'regexp=ARG', 'Optional. Restrict the search to proxies with names that match regexp.'],
        ['T' , 'targettype=ARG', `Required. One of [ ${allowedTargetTypes.toString()} ].`],
        ['' , 'filter=ARG', 'Optional. filter the set of proxies. valid values: (deployed, deployed:envname, latest).']
      ])).bindHelp();

let opt = null;

const isFilterLatestRevision = () => opt.options.filter == 'latest';
const isFilterDeployed = () => opt.options.filter == 'deployed';
const isFilterDeployedEnv = () => opt.options.filter && opt.options.filter.startsWith('deployed:') && opt.options.filter.slice(9);

const revisionMapper = (org, name) =>
  revision =>
  org.proxies.export({ name, revision })
  .then( result => {
    const zip = new AdmZip(result.buffer),
          re2 = new RegExp('^apiproxy/targets/[^/]+.xml$'),
          targetEndpoints = zip
      .getEntries()
      .filter( entry => entry.entryName.match(re2))
      .map( entry => {
        const data = entry.getData().toString('utf8'),
            doc = new DOM().parseFromString(data),
            endpointName = xpath.select('/TargetEndpoint/@name', doc)[0].value,
            elementName = { http : 'HTTPTargetConnection',
                            node: 'ScriptTarget',
                            hosted : 'HostedTarget'},
            xpathQuery = `/TargetEndpoint/${elementName[opt.options.targettype]}`,
            targetConnectionNodeset = xpath.select(xpathQuery, doc);
        return (targetConnectionNodeset && targetConnectionNodeset[0]) ?
          endpointName : null;
      });
    return targetEndpoints.filter(e => !!e);
  });

const revisionReducer = fn =>
 (p, revision) =>
    p.then( accumulator =>
            fn(revision)
            .then( targetEndpoints => [...accumulator, { revision, targetEndpoints }]));


const toRevisions = org =>
 (promise, name) =>
  promise .then( accumulator => {
    if (isFilterDeployedEnv() || isFilterDeployed()) {
      const environment = isFilterDeployedEnv();
      return org.proxies.getDeployments({ name, environment })
        .then( response => {
          if (response.deployments) {
            // GAAMBO
            const deployments = response.deployments.map( d => ({name, revision:[d.revision], environment:d.environment}));
            return [...accumulator, ...deployments];
          }
          if (response.revision) {
            // Admin API
            const deployments = response.revision.map( r => ({name, revision:[r.name]}));
            return [...accumulator, ...deployments];
          }
          return accumulator;
        })
        .catch( e => {
          if (e.code == "distribution.ApplicationNotDeployed") {
            return accumulator;
          }
          throw e;
        });
    }

    return org.proxies.get({ name })
      .then( ({revision}) => {
        if (isFilterLatestRevision()) {
          revision = [revision.pop()];
        }
        return [ ...accumulator, {name, revision} ];
      });
});

// ========================================================

console.log(
  `Apigee findProxyWithTargetType.js tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
opt = getopt.parse(process.argv.slice(2));

common.verifyCommonRequiredParameters(opt.options, getopt);

if ( ! opt.options.targettype || !allowedTargetTypes.includes(opt.options.targettype)) {
  console.log('You must specify a valid target type.');
  getopt.showHelp();
  process.exit(1);
}

apigee.connect(common.optToOptions(opt))
  .then (org =>
         org.proxies.get()
         .then( result => {
           // for GAAMBO
           let proxies = (opt.options.apigeex) ?
             result.proxies.map( p => p.name) : result;
           if (opt.options.regexp) {
             const re1 = new RegExp(opt.options.regexp);
             proxies = proxies.filter( item => re1.test(item) );
           }
           if ( !proxies || proxies.length == 0) {
             common.logWrite('No %sproxies', (opt.options.regexp)?"matching ":"");
             return Promise.resolve(true);
           }
           return proxies.sort()
             .reduce(toRevisions(org), Promise.resolve([]));
         })
         .then( candidates => {
           if (opt.options.verbose) {
             common.logWrite('found %d API candidate proxies for that org', candidates.length);
           }
           console.log('candidates: ' + JSON.stringify(candidates, null, 2));
           const r = (p, nameAndRevisions) =>
           p.then( accumulator => {
             const mapper = revisionMapper(org, nameAndRevisions.name);
            return nameAndRevisions.revision
              .reduce(revisionReducer(mapper), Promise.resolve([]))
              .then( a => {
                const mapped =
                  a.filter(item => item.targetEndpoints && item.targetEndpoints.length)
                  .map(e => ({environment: nameAndRevisions.environment, ...e }));

                return (mapped.length)? [...accumulator, {proxyname: nameAndRevisions.name, found:mapped}]: accumulator;
              });
        });
        return candidates.reduce(r, Promise.resolve([]));
         })
        )
  .then( r => console.log('' + JSON.stringify(r, null, 2)))
  .catch( e => console.log(util.format(e)));
