#! /usr/local/bin/node
/*jslint node:true */
// undeployAndMaybeDelete.js
// ------------------------------------------------------------------
// undeploy and maybe delete an Apigee Edge proxy that has a name with a specific prefix.
//
// Copyright 2017-2020 Google LLC.
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
// last saved: <2020-April-07 22:15:42>
/* jslint esversion:9 */

const edgejs     = require('apigee-edge-js'),
      util       = require('util'),
      common     = edgejs.utility,
      apigeeEdge = edgejs.edge,
      Getopt     = require('node-getopt'),
      version    = '20190211-1251',
      getopt     = new Getopt(common.commonOptions.concat([
        ['P' , 'prefix=ARG', 'required. name prefix. Undeploy and maybe delete all API Proxies with names starting with this prefix.' ],
        ['D' , 'delete', 'optional. Delete the proxies too. By default, just undeploy.' ]
      ])).bindHelp();

// ========================================================

function revEnvReducer(org, name, revision) {
  return (p, deployment) => {
    //console.log('deployment: ' + util.format(deployment));
    return p.then( () => org.proxies.undeploy({name, revision, environment: deployment.environment || deployment.name}));
  };
}

function revReducer(org, name) {
  return (p, revision) =>
    p.then( _ =>
            org.proxies.getDeployments({ name, revision })
            // morph to support GAAMBO or legacy API
            .then( r => r.deployments || r.environment)
            .then( deployments => {
              //console.log('deployments: ' + util.format(deployments));
              return (deployments && deployments.length > 0) ?
                deployments.reduce(revEnvReducer(org, name, revision), Promise.resolve()) :
                {};
            }));
}

function proxyReducer(org) {
  return (p, item) =>
    p.then( _ =>
            // morph to support GAAMBO or legacy API
            org.proxies.getRevisions({ name: item.name || item})
            .then( revisions =>
                   revisions.reduce(revReducer(org, item.name || item), Promise.resolve()))
            .then( _ => (opt.options.delete) ? org.proxies.del({ name: item.name || item}) : {} ));
}

console.log(
  'Apigee Edge Proxy Undeploy + Delete tool, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));
if ( ! opt.options.prefix ) {
  console.log('You must specify a name prefix. (-P)');
  getopt.showHelp();
  process.exit(1);
}

common.verifyCommonRequiredParameters(opt.options, getopt);

apigeeEdge.connect(common.optToOptions(opt))
  .then( (org) =>
    org.proxies.get()
      .then( r => {
        //console.log('r: ' + JSON.stringify(r));
        let [collection, predicate] = (r.proxies) ?
          [r.proxies, (p) => p.name.startsWith(opt.options.prefix)] :
          [r, p => p.startsWith(opt.options.prefix)];

        return collection
          .filter( p => predicate(p))
          .reduce(proxyReducer(org), Promise.resolve()) ;
      })
      .then( (results) => common.logWrite('all done...') )
  )
  .catch( e => console.log(util.format(e)));
