#! /usr/local/bin/node
/*jslint node:true */
// listAndQueryDevelopers.js
// ------------------------------------------------------------------
// list and query developers in Apigee Edge
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
// last saved: <2021-April-21 17:07:53>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.edge,
      util     = require('util'),
      sprintf  = require('sprintf-js').sprintf,
      Getopt   = require('node-getopt'),
      version  = '20210421-1701',
      getopt   = new Getopt(common.commonOptions.concat([
          ['E' , 'expand', 'optional. expand for each developer']
      ])).bindHelp();

// ========================================================
// process.argv array starts with 'node' and 'scriptname.js'
let opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
    console.log(
        `Apigee Developer query tool, version: ${version}\n` +
        `Node.js ${process.version}\n`);

    common.logWrite('start');
}

common.verifyCommonRequiredParameters(opt.options, getopt);

apigee
    .connect(common.optToOptions(opt))
    .then( org => {
        common.logWrite('connected');

        return org.developers.get({})
            .then( devs => {
                common.logWrite(sprintf('developers: %s', JSON.stringify(devs, null, 2)));
                if (opt.options.expand && Array.isArray(devs)) {

                    let r = (p, developerEmail) =>
                    p.then( acc =>
                            org.developers.get({ developerEmail })
                            .then( result => [...acc, result]));

                    return devs
                        .reduce(r, Promise.resolve([]))
                        .then(results => {
                            console.log(JSON.stringify(results, null, 2) + '\n');
                        });
                }
            });
    })
  .catch( e => console.log('while executing, error: ' + util.format(e)) );
