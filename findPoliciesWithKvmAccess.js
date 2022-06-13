#! /usr/local/bin/node
/*jslint node:true */
// findPoliciesWithKvmAccess.js
// ------------------------------------------------------------------
//
// In an Apigee organization, find all policies in all proxies that reference a
// KVM, and maybe a particular KVM.  This uses a brute-force search implemented
// on the client side (within this script), so it can take a while to run on an
// org that has many proxies, or many revisions. This will work only for Apigee
// Edge, won't work for X / hybrid.
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
// last saved: <2022-June-13 13:17:09>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.apigee,
      sprintf  = require('sprintf-js').sprintf,
      util     = require('util'),
      Getopt   = require('node-getopt'),
      version  = '20220613-1316',
      getopt   = new Getopt(common.commonOptions.concat([
        ['M' , 'kvm=ARG', 'Optional. KVM name to find.'],
        ['S' , 'scope=ARG', 'Optional. Scope to match. Should be one of: (organization, environment, apiproxy)'],
        ['' , 'list', 'Optional. don\'t find. list the available KVMs for the org/environment.'],
        ['' , 'latestrevision', 'Optional. only look in the latest revision number for each proxy.'],
        ['R' , 'regex=ARG', 'optional. a regular expression. query only proxies with names matching this pattern.' ]
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
// process.argv array starts with 'node' and 'scriptname.js'
let opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  console.log(
    `Apigee KVM check tool, version: ${version}\n` +
      `Node.js ${process.version}\n`);

  common.logWrite('start');
}

const policyUrl = (proxyName, revision, policyName) =>
sprintf("/v1/organizations/%s/apis/%s/revisions/%s/policies/%s",
        opt.options.org, proxyName, revision, policyName);


common.verifyCommonRequiredParameters(opt.options, getopt);
let opts = common.optToOptions(opt);
if (opts.apigeex) {
  throw new Error('this will work for Apigee Edge, not X or hybrid');
}

apigee
  .connect(opts)
  .then( org => {

    common.logWrite('connected');
    if (opt.options.list) {
      return org.kvms.get({})
        .then( result => console.log(JSON.stringify(result)));
    }

    return org.proxies.get({})
      .then( proxies => {
        proxies = proxies
          .sort()
          .filter( isKeeper(opt) );

        common.logWrite('found %d proxies', proxies.length);


        let fn3 = (name, revision) => (p, policy) =>
        p.then( acc =>
             org.proxies.getPoliciesForRevision({ name, revision, policy })
                .then( result => {
                  let b = (result.policyType == 'KeyValueMapOperations') &&
                    ( ! opt.options.kvm || (opt.options.kvm == result.mapIdentifier)) &&
                    ( ! opt.options.scope || (opt.options.scope == result.scope));
                  return b ? [...acc, policy] : acc;
                }));

        let fn2 = name => (p, revision) =>
        p.then( acc =>
                org.proxies.get({ name, revision })
                .then( async result => {
                  let r = await result.policies.reduce(fn3(name, revision), Promise.resolve([]));
                  r = r.map( policyName => policyUrl(name, revision, policyName));
                  return (r.length)? [...acc, {revision, policies: r}] : acc;
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
            results = results.filter( item => item ); // null item means no regexp match for that proxy
            console.log(JSON.stringify({results, count:results.length}, null, 2) + '\n');
          });
      });
  })
  .catch( e => console.error('error: ' + util.format(e) ));
