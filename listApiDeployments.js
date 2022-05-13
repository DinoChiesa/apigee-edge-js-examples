#! /usr/local/bin/node
/*jslint node:true */
// listApiDeployments.js
// ------------------------------------------------------------------
// list deployments for a particular environment in Apigee
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
// last saved: <2022-May-11 11:17:35>

const apigeejs   = require('apigee-edge-js'),
      util       = require('util'),
      common     = apigeejs.utility,
      apigee     = apigeejs.apigee,
      sprintf    = require('sprintf-js').sprintf,
      Getopt     = require('node-getopt'),
      version    = '20220511-1117',
      getopt     = new Getopt(common.commonOptions.concat([
          ['e' , 'environment=ARG', 'Optional. inquire and show the deployments for a particular environment.'],
      ])).bindHelp();

// ========================================================

console.log(
  `Apigee API Deployments List tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));
common.verifyCommonRequiredParameters(opt.options, getopt);

apigee.connect(common.optToOptions(opt))
  .then(org =>
    org.getApiDeployments({environment:opt.options.environment})
        .then(resp => {
          // GAAMBO or Edge
          let proxies = (resp.aPIProxy) ?
            resp.aPIProxy.map(p => ({
              name:p.name,
              revision: p.revision.map( r => ({configuration: r.configuration, name: r.name, state: r.state}) )
            })) :
            resp;
          common.logWrite(sprintf('found %d proxies', proxies.length));
          return proxies;
        }))
  .then(results => console.log('results: ' + JSON.stringify(results, null, 2)))
  .catch( e => console.error('error: ' + util.format(e) ));
