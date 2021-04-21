#! /usr/local/bin/node
/*jslint node:true, esversion:9 */
// findVhost.js
// ------------------------------------------------------------------
//
// In Apigee, find all proxies with a reference vhost. Can be helpful in
// tracking the use of the 'default' (insecure) vhost in proxies.
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
// last saved: <2021-April-21 16:41:36>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      util     = require('util'),
      apigee   = apigeejs.edge,
      sprintf  = require('sprintf-js').sprintf,
      Getopt   = require('node-getopt'),
      version  = '20210421-1610',
      getopt   = new Getopt(common.commonOptions.concat([
        ['V' , 'vhost=ARG', 'Required. The vhost to look for.'],
        ['' , 'latestrevision', 'Optional. only look in the latest revision number for each proxy.'],
        ['' , 'regex=ARG', 'optional. a regular expression. query only proxies with names matching this pattern.' ]
      ])).bindHelp();

function isKeeper(opt) {
  if (opt.options.regex) {
    if (opt.options.verbose) {
      common.logWrite('using regex match (%s)',opt.options.regex);
    }
    return name => name.match(new RegExp(opt.options.regex));
  }

  return () => true;
}

// ========================================================

process.on('unhandledRejection',
            r => console.log('\n*** unhandled promise rejection: ' + util.format(r)));

let opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee Edge VHost finder tool, version:${version}\n` +
      `Node.js ${process.version}\n`);

  common.logWrite('start');
}


const endpointUrl = (proxyName, revision, endpointName) =>
sprintf("/v1/o/%s/apis/%s/revisions/%s/proxies/%s",
        opt.options.org, proxyName, revision, endpointName);

// ========================================================================================

common.verifyCommonRequiredParameters(opt.options, getopt);

if ( ! opt.options.vhost) {
  console.log('The vhost is required.');
  getopt.showHelp();
  process.exit(1);
}

apigee
  .connect(common.optToOptions(opt))
  .then(org =>
        org.proxies.get({})
        .then( proxies => {
        proxies = proxies
          .sort()
          .filter( isKeeper(opt) );

        common.logWrite('found %d proxies', proxies.length);

        let fn3 = (name, revision) => (p, endpoint) =>
        p.then( acc =>
             org.proxies.getProxyEndpoints({ name, revision, endpoint })
                .then( result => {
                  let isMatch = result.connection.connectionType === 'httpConnection' &&
                    result.connection.virtualHost.indexOf(opt.options.vhost) >= 0;
                  // if removing, add here.
                  return isMatch ? [...acc, endpoint] : acc;
                }));

        let fn2 = name => (p, revision) =>
        p.then( acc =>
                org.proxies.get({ name, revision })
                .then( async result => {
                  let r = await result.proxies.reduce(fn3(name, revision), Promise.resolve([]));
                  r = r.map( endpointName => endpointUrl(name, revision, endpointName));
                  return (r.length)? [...acc, {revision, endpoints: r}] : acc;
                }));

        let fn1 = (p, name) =>
        p.then( acc =>
                org.proxies.get({ name })
                .then( async result => {
                  if (opt.options.latestrevision) {
                    result.revision.sort();
                    result.revision = [result.revision.pop()];
                  }
                  let r = await result.revision.reduce(fn2(name), Promise.resolve([]));
                  return (r.length)? [...acc, {proxy: name, revisions: r}] : acc;
                }));

        return proxies
          .reduce(fn1, Promise.resolve([]))
          .then(results => {
            results = results.filter( item => item );
            console.log(JSON.stringify({results, count:results.length}, null, 2) + '\n');
          });

        }))
  .catch( e => console.log('while executing, error: ' + util.format(e)) );
