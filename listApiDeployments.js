#! /usr/local/bin/node
/*jslint node:true */
// listApiDeployments.js
// ------------------------------------------------------------------
// list deployments for a particular Apigee environment, or
// all environments in an Apigee organization.
//
// Copyright 2017-2022, 2025 Google LLC.
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
// last saved: <2025-January-16 22:23:29>

const apigeejs = require("apigee-edge-js"),
  util = require("util"),
  common = apigeejs.utility,
  apigee = apigeejs.apigee,
  sprintf = require("sprintf-js").sprintf,
  Getopt = require("node-getopt"),
  version = "20250116-2115",
  getopt = new Getopt(
    common.commonOptions.concat([
      [
        "e",
        "environment=ARG",
        "Optional. inquire and show the deployments for a particular environment.",
      ],
    ]),
  ).bindHelp();

async function getDeployments(org, environment) {
  let organization = await org.getName();
  return org.getApiDeployments({ environment }).then((resp) => {
    // GAAMBO
    if (resp.deployments) {
      return resp.deployments.map((d) => {
        // each item is like this:
        // {
        //   "environment": "eval",
        //   "apiProxy": "identity-facade-v1",
        //   "revision": "1",
        //   "deployStartTime": "1686598206747",
        //   "proxyDeploymentType": "EXTENSIBLE"
        // }
        delete d.proxyDeploymentType;
        d.organization = organization;
        return d;
      });
    }
    // Edge
    if (resp.aPIProxy) {
      // each item is like this:
      // {
      //   "name": "decodejws-1",
      //   "revision": [
      //     {
      //       "configuration": {
      //         "basePath": "/",
      //         "configVersion": "SHA-512:d9331d1a1b48498094c297855a942fd7c4b51eef6d433feadc2426c91175f92cc0bc169ece2d5ab0173027757898079ecf1d3f132cff0a62829c5a62d930b980",
      //         "steps": []
      //       },
      //       "name": "2",
      //       "server": [ ... ]
      //       "state": "deployed"
      //     }
      //   ]
      // }

      // This will format it like the result from GAAMBO.
      return resp.aPIProxy.reduce(
        (accumulator, p) =>
          accumulator.concat(
            p.revision.map((r) => ({
              organization,
              environment,
              apiProxy: p.name,
              revision: r.name,
            })),
          ),
        [],
      );
    }

    throw new Error("unexpected response format");
  });
}

// ========================================================

console.log(
  `Apigee API Deployments List tool, version: ${version}\n` +
    `Node.js ${process.version}\n`,
);

common.logWrite("start");

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));
common.verifyCommonRequiredParameters(opt.options, getopt);

apigee
  .connect(common.optToOptions(opt))
  .then((org) => {
    if (opt.options.environment) {
      return getDeployments(org, opt.options.environment);
    }

    //  else, no environment specified. Query environments and retrieve all.
    return org.environments.get().then((resp) => {
      const reducer = (promise, item) =>
        promise.then((a) =>
          getDeployments(org, item).then((deployments) => {
            //console.log(JSON.stringify(deployments));
            return [...a, ...deployments];
          }),
        );
      return resp.reduce(reducer, Promise.resolve([]));
    });
  })
  .then((results) => {
    if (opt.options.verbose) {
      console.log("results: " + JSON.stringify(results, null, 2));
    }
    common.logWrite(sprintf("found %d deployments", results.length));
    let byEnvCounts = results.reduce((a, c) => {
      let id = `${c.organization}/${c.environment}`;
      if (!a.hasOwnProperty(id)) {
        a[id] = 0;
      }
      a[id]++;
      return a;
    }, {});
    common.logWrite(JSON.stringify(byEnvCounts, null, 2));
  })
  .catch((e) => console.error("error: " + util.format(e)));
