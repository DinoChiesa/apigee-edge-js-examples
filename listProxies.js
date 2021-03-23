#! /usr/local/bin/node
/*jslint node:true */
// listProxies.js
// ------------------------------------------------------------------
// list proxies (and maybe deployments of same) in Apigee
//
// Copyright 2017-2021 Google LLC.
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
// last saved: <2021-March-23 08:56:02>

const apigeejs   = require('apigee-edge-js'),
      util       = require('util'),
      common     = apigeejs.utility,
      apigee     = edgejs.apigee,
      sprintf    = require('sprintf-js').sprintf,
      Getopt     = require('node-getopt'),
      version    = '20210323-0855',
      getopt     = new Getopt(common.commonOptions.concat([
          ['E' , 'elaborate', 'Optional. inquire and show the deployments of each proxy, too.'],
      ])).bindHelp();

// ========================================================

console.log(
  `Apigee List & Query Proxies tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));
common.verifyCommonRequiredParameters(opt.options, getopt);

apigee.connect(common.optToOptions(opt))
.then(org =>
    org.proxies.get({})
      .then(proxies => (common.logWrite(sprintf('found %d proxies', proxies.length)), proxies))
      .then(proxies =>
           (opt.options.elaborate) ?
               proxies
                  .reduce((promise, item) =>
                          promise .then( accumulator =>
                               org.proxies.getDeployments({ name: item })
                               .then( result =>
                                       [ ...accumulator, {
                                           proxy:item,
                                           deployedEnvironments:
                                           result.environment.map( env => ({
                                               name: env.name,
                                               revisions: env.revision.map( rev => rev.name)
                                           }))
                                       }]
                                    )), Promise.resolve([])) :
            proxies))
    .then(results => console.log('results: ' + JSON.stringify(results, null, 2)))
    .catch( e => console.error('error: ' + util.format(e) ) );
