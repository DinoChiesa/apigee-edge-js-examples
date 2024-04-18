// findAppForProxy.js
// ------------------------------------------------------------------
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
// created: Mon Mar 20 09:57:02 2017
// last saved: <2024-April-17 17:29:30>

const apigeejs = require("apigee-edge-js"),
  common = apigeejs.utility,
  apigee = apigeejs.apigee,
  util = require("util"),
  Getopt = require("node-getopt"),
  version = "20240417-1723",
  getopt = new Getopt(
    common.commonOptions.concat([
      ["P", "proxy=ARG", "required. the proxy for which to list apps."]
    ])
  ).bindHelp();

// ========================================================
process.on("unhandledRejection", (r) =>
  console.log("\n*** unhandled promise rejection: " + util.format(r))
);

console.log(
  `Apigee findAppForProxy.js tool, version: ${version}\nNode.js ${process.version}\n`
);

common.logWrite("start");

// process.argv array starts with 'node' and 'scriptname.js'
const opt = getopt.parse(process.argv.slice(2));

common.verifyCommonRequiredParameters(opt.options, getopt);

if (!opt.options.proxy) {
  console.log("You must specify a proxy to find");
  getopt.showHelp();
  process.exit(1);
}

apigee
  .connect(common.optToOptions(opt))
  .then((org) => {
    common.logWrite("searching...");
    org.products.get({ expand: true }).then((result) => {
      const apiproducts = result.apiProduct;
      common.logWrite(
        "total count of API products for that org: %d",
        apiproducts.length
      );
      const filteredProducts = apiproducts.filter((p) => {
        if (p.proxies) {
          return p.proxies.indexOf(opt.options.proxy) >= 0;
        }
        return (
          p.operationGroup &&
          p.operationGroup.operationConfigType == "proxy" &&
          p.operationGroup.operationConfigs.find(
            (c) => c.apiSource == opt.options.proxy
          )
        );
      });

      common.logWrite(
        "count of API products containing %s: %d",
        opt.options.proxy,
        filteredProducts.length
      );
      if (filteredProducts.length) {
        common.logWrite(
          `list: ${filteredProducts.map((item) => item.name).join(", ")}`
        );
        org.apps.get({ expand: true }).then((result) => {
          const apps = result.app;
          common.logWrite("total count of apps for that org: %d", apps.length);
          const filteredProductNames = filteredProducts.map((p) => p.name);
          const filteredApps = apps.filter((app) => {
            const creds = app.credentials.filter((cred) =>
              cred.apiProducts.find((prod) =>
                filteredProductNames.includes(prod.apiproduct)
              )
            );
            return creds && creds.length > 0;
          });

          if (filteredApps) {
            common.logWrite(
              "count of Apps containing %s: %d",
              opt.options.proxy,
              filteredApps.length
            );
            if (filteredApps.length) {
              filteredApps.forEach((a, ix) => {
                common.logWrite(
                  `${ix}: /v1/organizations/${org.conn.orgname}/developers/${a.developerId}/apps/${a.name}`
                );
              });
            }
            if (opt.options.verbose) {
              common.logWrite(JSON.stringify(filteredApps, null, 2));
            }
          } else {
            common.logWrite("none found");
          }
        });
      }
    });
  })
  .catch((e) => console.log("while executing, error: " + util.format(e)));
