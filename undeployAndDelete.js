#! /usr/local/bin/node
/*jslint node:true */
// undeployAndDelete.js
// ------------------------------------------------------------------
// undeploy and delete an Apigee Edge proxy that has a name with a specific prefix.
//
// Copyright 2017-2023 Google LLC.
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
// last saved: <2023-December-14 12:35:48>

const apigeejs   = require('apigee-edge-js'),
      common     = apigeejs.utility,
      apigee     = apigeejs.apigee,
      util       = require('util'),
      Getopt     = require('node-getopt'),
      version    = '20231214-1230',
      getopt     = new Getopt(common.commonOptions.concat([
          ['' , 'namepattern=ARG', 'Optional. specify a regex as a pattern for the proy name'],
        ['P' , 'prefix=ARG', 'Optional. a name prefix. All API Proxies with names starting with this prefix will be removed.' ]
      ])).bindHelp();

// ========================================================

function removeOneProxy(org, proxyName) {
  return org.environments.get()
    .then(environments => {
      const reducer =
        (promise, env) =>
      promise .then( accumulator =>
                     org.proxies.undeploy({ name: proxyName, env })
                     .then( r => [ ...accumulator, {env, r} ] )
                   );
      return environments
        .reduce(reducer, Promise.resolve([]))
        .then( _ => org.proxies.del({name: proxyName}));
    });
}

function doneAllProxies(results) {
  var flattened = [].concat.apply([], results);
  common.logWrite('result %s', JSON.stringify(flattened));
}

console.log(
  `Apigee Proxy Undeploy + Delete tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));
if ( ! opt.options.prefix  && !opt.options.namepattrn) {
  console.log('You must specify a name prefix (-P) or a namepattern option');
  getopt.showHelp();
  process.exit(1);
}

common.verifyCommonRequiredParameters(opt.options, getopt);

apigee
  .connect(common.optToOptions(opt))
  .then(org => {
    common.logWrite('connected');
    common.logWrite('undeploying and deleting...');
    return org.proxies.get()
      .then(resp => {
        // GAAMBO
        let proxies = (resp.proxies) ? resp.proxies.map(p => p.name) : resp;
        common.logWrite(`found ${proxies.length} proxies`);
        return proxies;
      })
      .then( proxies =>
             // filter
             (opt.options.prefix) ?
             proxies.filter( name => name.startsWith(opt.options.prefix))
             : proxies.filter( p => p.match(new RegExp(opt.options.namepattern))) )
      .then(proxies => {
        const reducer = (promise, item) =>
          promise .then( a => removeOneProxy(org, item) .then( r => [ ...a, {item, r} ] ) );
        return proxies
          .reduce(reducer, Promise.resolve([]))
          .then( doneAllProxies );
      });
  })
  .catch( e => console.log('while executing, error: ' + util.format(e)) );
