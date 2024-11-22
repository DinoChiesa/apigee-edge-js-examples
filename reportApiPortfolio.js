#! /usr/local/bin/node
/*jslint node:true */
// reportApiPortfolio.js
// ------------------------------------------------------------------
// report API exposures for a particular environment in Apigee Edge
//
// Copyright 2017-2024 Google LLC.
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
// last saved: <2024-November-22 21:21:24>

const apigeejs = require("apigee-edge-js"),
  util = require("util"),
  common = apigeejs.utility,
  apigee = apigeejs.apigee,
  sprintf = require("sprintf-js").sprintf,
  Getopt = require("node-getopt"),
  version = "20241122-2117",
  getopt = new Getopt(
    common.commonOptions.concat([
      [
        "e",
        "environment=ARG",
        "Optional. inquire and show the deployments for a particular environment.",
      ],
    ]),
  ).bindHelp();

// ========================================================

function baseUris(vhost) {
  let scheme = vhost.sSLInfo ? "https" : "http";
  let portSuffix = "";
  if (vhost.sSLInfo) {
    if (vhost.port != "443") {
      portSuffix = ":" + vhost.port;
    }
  } else {
    if (vhost.port != "80") {
      portSuffix = ":" + vhost.port;
    }
  }
  return vhost.hostAliases.map((ha) => `${scheme}://${ha}${portSuffix}`);
}

console.log(
  `Apigee API Portfolio Reporting tool, version: ${version}\n` +
    `Node.js ${process.version}\n`,
);

common.logWrite("start");

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));
common.verifyCommonRequiredParameters(opt.options, getopt);

if (opt.apigeex) {
  throw new Error("this tool does not work with X/hybrid");
}

apigee
  .connect(common.optToOptions(opt))
  .then(async (org) => {
    // get baseURIs for Vhosts
    let vhosts = await org.environments.getVhosts({
      environment: opt.options.environment,
    });

    let vhostinfos = {};
    for (const vhname of vhosts) {
      const vhost = await org.environments.getVhost({
        environment: opt.options.environment,
        name: vhname,
      });
      vhostinfos[vhname] = vhost;
      vhostinfos[vhname].baseUris = baseUris(vhostinfos[vhname]);
    }

    // now examine all deployed proxies in the environment
    let items = await org
      .getApiDeployments({ environment: opt.options.environment })
      .then((resp) => {
        if (resp.aPIProxy) {
          return resp.aPIProxy.reduce((a, c) => {
            const b = c.revision.map((r) => ({
              apiProxy: c.name,
              revision: r.name,
            }));

            return a.concat(b);
          }, []);
        }

        // catch X / hybrid
        throw new Error("this tool does not work with X/hybrid");
      });

    // get proxyendpoints and basepaths for each of those proxy/revision pairs
    let found = [];
    for (const item of items) {
      const itemrev = await org.proxies.get({
        name: item.apiProxy,
        revision: item.revision,
      });

      found.push({
        name: itemrev.name,
        revision: item.revision,
        endpoints: itemrev.proxyEndpoints,
      });
    }

    // produce a report, merging vhosts with those proxyendpoints
    let report = [];
    for (const item of found) {
      for (const ep of item.endpoints) {
        let epdata = await org.proxies.getEndpoint({
          name: item.name,
          revision: item.revision,
          endpoint: ep,
        });

        const b2 = epdata.connection.virtualHost.map((vhname) => {
          return {
            proxyName: item.name,
            revision: item.revision,
            vhost: vhname,
            endpoint: ep,
            uris: vhostinfos[vhname].baseUris.map(
              (u) => u + epdata.connection.basePath,
            ),
          };
        });
        report = report.concat(b2);
      }
    }
    console.log("report: " + JSON.stringify(report, null, 2));
  })
  .catch((e) => console.error("error: " + util.format(e)));
