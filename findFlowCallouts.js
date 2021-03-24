#! /usr/local/bin/node
/*jslint node:true */
// findFlowCallouts.js
// ------------------------------------------------------------------
// In an Apigee Edge organization, find all proxies that include a FlowCallout,
// and optionally a calloput to a specific (named) sharedflow.  This uses a
// brute-force client-side search, so it will take a while to run on an org that
// has many proxy revisions.
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
// last saved: <2021-March-24 14:10:33>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      sprintf  = require('sprintf-js').sprintf,
      util     = require('util'),
      Getopt   = require('node-getopt'),
      version  = '20210323-1114',
      getopt   = new Getopt(common.commonOptions.concat([
        ['F' , 'sharedflow=ARG', 'Optional. find only FlowCallouts referencing a specific Sharedflow.'],
        ['L' , 'list', 'Optional. don\'t find. just list the SharedFlows in the org.'],
        ['' , 'latestrevision', 'Optional. only look in the latest revision number for each proxy.']
      ])).bindHelp();

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
 sprintf("/v1/o/%s/apis/%s/revisions/%s/policies/%s",
                 opt.options.org, proxyName, revision, policyName);


common.verifyCommonRequiredParameters(opt.options, getopt);

apigee.connect(common.optToOptions(opt))
  .then( org => {
    common.logWrite('connected');
    if (opt.options.list) {
      return org.sharedflows.get({})
        .then( result => {
          common.logWrite('found %d sharedflows', result.length);
          common.logWrite(result.join(', '));
        });
    }

    return org.proxies.get({})
      .then( proxies => {
        common.logWrite('found %d proxies', proxies.length);

        let fn3 = (name, revision) => (p, policy) =>
        p.then( acc =>
                org.proxies.get({ name, revision, policy })
                .then( result =>
                       (result.policyType === 'FlowCalloutBean') &&
                       ( ! opt.options.sharedflow || (opt.options.sharedflow == result.sharedFlowBundle)) ?
                       [...acc, policy] : acc));

        let fn2 = (name) => (p, revision) =>
        p.then( acc =>
                org.proxies.get({ name, revision })
                .then( async result => {
                  let r = await result.policies.reduce(fn3(name, revision), Promise.resolve([]));
                  r = r.map(policyName => policyUrl(name, revision, policyName));
                  return (r.length) ? [...acc, r] : acc;
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
                  return (r.length)? [...acc, {proxy: name, policies: r}] : acc;
                }));

        return proxies
          .reduce(fn1, Promise.resolve([]));
      });
  })

  .then( r => {
    console.log(JSON.stringify(r, null, 2));
  })

  .catch( e => console.log('while executing, error: ' + util.format(e)) );
