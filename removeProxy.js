// removeProxy.js
// ------------------------------------------------------------------
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
// created: Mon Mar 20 09:57:02 2017
// last saved: <2021-March-23 08:54:47>
/* global process */

const apigeejs   = require('apigee-edge-js'),
      util       = require('util'),
      common     = apigeejs.utility,
      apigee     = apigeejs.apigee,
      Getopt     = require('node-getopt'),
      version    = '20210323-0854',
      getopt     = new Getopt(common.commonOptions.concat([
        ['P', 'proxy=ARG', 'Required. the proxy to remove.'],
        ['' , 'doit', 'Optional. actually make the desired changes.']
      ])).bindHelp();

// ========================================================

console.log(
  `Apigee Edge removeProxy.js tool, version: ${version}\n` +
    `Node.js ${process.version}\n`);

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

common.verifyCommonRequiredParameters(opt.options, getopt);

if ( !opt.options.proxy ) {
  console.log('You must specify a proxy to remove');
  getopt.showHelp();
  process.exit(1);
}
if ( ! opt.options.doit) {
  common.logWrite('will not make any changes...');
}

apigee.connect(common.optToOptions(opt))
  .then(org =>
        org.proxies.get({name:opt.options.proxy})
        .then(proxy => JSON.stringify(proxy))
        .then(_ =>
              org.products.get({expand:true})
              .then(result => {
                let apiproducts = result.apiProduct;
                if (opt.options.verbose) {
                  common.logWrite('found %d API products for that org', apiproducts.length);
                }
                let filtered = apiproducts.filter( product => (product.proxies.indexOf(opt.options.proxy) >= 0));

                common.logWrite('found %d API products containing proxy %s', filtered.length, opt.options.proxy);
                if (filtered.length) {
                  if (opt.options.verbose) {
                    common.logWrite('list: ' + JSON.stringify(filtered.map( item => item.name)));
                  }

                  const reducer = (p, product) =>
                    p.then( a => {
                      product.proxies = product.proxies.filter( x => ( x !== opt.options.proxy ));
                      if (product.proxies.length) {
                        // at least one proxy remains, update the product
                        if (opt.options.doit) {
                          return org.products.update(product)
                            .then( product => [ ...a, {name:product.name, proxies:product.proxies, status:'updated'} ] );
                        }
                        return [ ...a, {name:product.name, proxies:product.proxies, status:'will-be-updated'} ];
                      }
                      else {
                        // no other proxies in the list, delete the product
                        if (opt.options.doit) {
                          return org.products.del(product)
                            .then( product => [ ...a, {name:product.name, status:'deleted' }] );
                        }
                        return [ ...a, {name:product.name, status:'will-be-deleted' } ];
                      }
                    });

                  return filtered
                    .reduce(reducer, Promise.resolve([]))
                    .then(results => console.log(JSON.stringify({products:results}, null, 2)));
                }
                return Promise.resolve(true);
              }))

        .then( _ =>
               org.proxies.getDeployments({ name: opt.options.proxy })
               .then( result =>
                      ({
                        deployedEnvironments:
                        result.environment.map( env => ({
                          name: env.name,
                          revisions: env.revision.map( rev => rev.name)
                        }))
                      })
                    )
               .then(result => {
                 const r1 = (environment) => (p, revision) =>
                   p.then( a => {
                     if (opt.options.doit) {
                       return org.proxies.undeploy({name:opt.options.proxy, environment, revision})
                         .then( result => [...a, revision] );
                     }
                     return [...a, revision];
                   });

                 const r2 = (p, deployedEnvironment) =>
                   p.then( async a => [...a, {
                     environment: deployedEnvironment.name,
                     revs: await deployedEnvironment.revisions.reduce(r1(deployedEnvironment.name), Promise.resolve([]))
                   }] );

                 return result.deployedEnvironments.reduce(r2, Promise.resolve([]));
               })
               .then(results => console.log(JSON.stringify({undeployments:results}, null, 2))))
        .then( _ => {
          if (opt.options.doit) {
            return org.proxies.del({name:opt.options.proxy});
          }
          common.logWrite('not making any changes... (see the --doit option)');
          return opt.options.proxy;
        }))

  .catch( e => console.error('error: ' + util.format(e) ) );
