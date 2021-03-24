#! /usr/local/bin/node
/*jslint node:true, esversion:9 */
// findVhostsForDeployedProxies.js
// ------------------------------------------------------------------
// In Apigee, for all proxies, find the latest deployed revision and
// identify the vhosts used within. Optionally filter the list for proxies that
// have endpoints with names that match a specific regexp. Example, to find
// proxies that listen on the default vhost:
//
//  node ./findVhostsForDeployedProxies.js -n -v -o myorgname -R default
//
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
// last saved: <2021-March-23 17:38:23>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      sprintf  = require('sprintf-js').sprintf,
      Getopt   = require('node-getopt'),
      version  = '20210323-0857',
      getopt   = new Getopt(common.commonOptions.concat([
        ['R' , 'regexp=ARG', 'Optional. List proxies with vhosts matching this regexp.'],
        ['P' , 'proxyregexp=ARG', 'Optional. consider only proxies with names matching this regexp.']
      ])).bindHelp();

var gVhostRegexp;

// ========================================================
let opt = getopt.parse(process.argv.slice(2));
if (opt.options.verbose) {
  console.log(
    `Apigee vhost-for-proxy query tool, version: ${version}\n` +
      `Node.js ${process.version}\n`);

  common.logWrite('start');
}

function latestDeployment(proxyDeployment) {
  let item = { proxyname : proxyDeployment.name, deployments: [] };
  proxyDeployment.environment.forEach( environmentDeployment => {
    //console.log(JSON.stringify(environmentDeployment, null, 2) + '\n');
    environmentDeployment.revision.forEach ( rev => {
      let list = item.deployments.find( x => x.revision == rev.name );
      if ( ! list ) {
        list = { revision: rev.name, environments: []} ;
        item.deployments.push(list);
      }
      list.environments.push(environmentDeployment.name);
    });
  });
  return item;
}

common.verifyCommonRequiredParameters(opt.options, getopt);

if (opt.options.regexp) {
  gVhostRegexp = new RegExp(opt.options.regexp);
}

apigee
  .connect(common.optToOptions(opt))
  .then( org =>
         org.proxies.get({})
         .then( proxies => {
           if (opt.options.verbose) {
             common.logWrite('proxies: %s', JSON.stringify(proxies));
           }
           if (proxies.length > 0) {
             // optionally filter the list of proxies to scan
             if (opt.options.proxyregexp) {
               let re1 = new RegExp(opt.options.proxyregexp);
               proxies = proxies.filter( item => re1.test(item));
               if (opt.options.verbose) {
                 common.logWrite('filtered: %s', JSON.stringify(proxies));
               }
             }

             let fn3 = (apiproxy, revision) => (p, endpoint)=>
             p.then( acc =>
                     org.proxies.getEndpoint({apiproxy, revision, endpoint})
                     .then( r => [...acc, { endpoint, virtualHosts : r.connection.virtualHost}]));

             let fn2 = (proxyName) =>
             (p, revEnvironment) =>
             p.then( acc => {
               if ( ! revEnvironment.environments || revEnvironment.environments.length == 0) {
                 return acc;
               }
               return org.proxies.getProxyEndpoints({apiproxy:proxyName, revision: revEnvironment.revision})
                 .then(async endpoints => {
                   //console.log('endpoints: ' + JSON.stringify(endpoints));
                   let reduction = await endpoints.reduce(fn3(proxyName, revEnvironment.revision), Promise.resolve([]));
                   //console.log('reduction: ' + JSON.stringify(reduction));
                   if (opt.options.regexp) {
                     reduction = reduction.filter( endpt =>
                                                   endpt.virtualHosts.filter( item => gVhostRegexp.test(item) ).length>0 );
                   }
                   return (reduction.length) ? [...acc, {
                     name:revEnvironment.revision,
                     environments: revEnvironment.environments,
                     endpoints:reduction
                   }] : acc;
                 });
             });

             let fn1 = (p, name) =>
             p.then( acc =>
                     org.proxies.getDeployments({ name })
                     .then( result => latestDeployment(result) )
                     .then( async latest => {
                       //console.log(JSON.stringify(latest));
                       let r = await latest.deployments.reduce(fn2(name), Promise.resolve([]));
                       return (r.length)? [...acc, {proxy: name, revisions: r}] : acc;
                     }));

             return proxies
               .reduce(fn1, Promise.resolve([]))
               .then(results => {
                 results = results.filter( item => item ); // null item means no regexp match for that proxy
                 console.log(JSON.stringify({results, count:results.length}, null, 2) + '\n');
               });
           }
         }))
  .catch(e => {
    console.log(e);
    console.log(e.stack);
  } );
