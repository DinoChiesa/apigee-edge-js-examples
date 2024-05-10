// checkProductOverlap.js
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
// last saved: <2024-May-09 16:52:32>
/* global process */

const apigeejs = require("apigee-edge-js"),
  util = require("util"),
  common = apigeejs.utility,
  apigee = apigeejs.apigee,
  Getopt = require("node-getopt"),
  version = "20240509-1625",
  getopt = new Getopt(
    common.commonOptions.concat([
      [
        "",
        "appname=ARG",
        "optional. scan only apps with name that matches this regex"
      ]
    ])
  ).bindHelp();

const opsForOneProduct = (org) => {
  const cache = {};

  return (productName) => {
    if (cache[productName]) {
      return Promise.resolve(cache[productName]);
    }
    return org.products.get({ name: productName }).then((productDetails) => {
      cache[productName] =
        productDetails.operationGroup.operationConfigType != "proxy"
          ? []
          : productDetails.operationGroup.operationConfigs;
      return cache[productName];
    });
  };
};

const gatherOneCredential = (org) => (credential) => {
  const getOps = opsForOneProduct(org);

  const reducer = (promise, item) =>
    promise.then(async (accumulator) => [
      ...accumulator,
      { prod: item, ops: await getOps(item) }
    ]);

  return credential.apiProducts
    .map((item) => item.apiproduct)
    .reduce(reducer, Promise.resolve([]));
};

const intersects = (a1, a2) => a1.filter((value) => a2.includes(value));

const cpy = ({ quota: _, ...rest }) => rest;

const overlappingOp = (op1, op2) =>
  op1.apiSource == op2.apiSource &&
  op1.operations.find((operation1) =>
    op2.operations.find(
      (operation2) =>
        operation1.resource == operation2.resource &&
        intersects(operation1.methods, operation2.methods)
    )
  );

const findOverlaps = (elaboratedProducts) => {
  // elaboratedProducts = [
  //   {
  //     prod: "ConfigTest-2",
  //     ops: [
  //       {
  //         apiSource: "verify-1",
  //         operations: [
  //           {
  //             resource: "/*",
  //             methods: ["GET"]
  //           }
  //         ],
  //         quota: {}
  //       }
  //     ]
  //   },
  //   {
  //     prod: "ConfigTest-1",
  //     ops: [
  //       {
  //         apiSource: "verify-1",
  //         operations: [
  //           {
  //             resource: "/*",
  //             methods: ["GET"]
  //           }
  //         ],
  //         quota: {}
  //       }
  //     ]
  //   }
  // ];

  // compare all but last prod to all others
  const allButLast = elaboratedProducts.slice(0, -1);
  const overlaps = allButLast.reduce((a, thisprod, i) => {
    const others = elaboratedProducts.filter((_c, ix2) => i != ix2);
    const opsWithOverlaps = thisprod.ops.reduce((a, op1) => {
      const otherProdsWithOverlap = others.reduce((acc, otherprod, _i) => {
        const foundop = otherprod.ops.find((op2) => overlappingOp(op1, op2));
        return foundop
          ? [...acc, { prod: otherprod.prod, op: cpy(foundop) }]
          : acc;
      }, []);
      return [...a, ...otherProdsWithOverlap];
    }, []);

    return opsWithOverlaps.length
      ? [...a, { prod: thisprod.prod, overlapsWith: opsWithOverlaps }]
      : a;
  }, []);

  return overlaps;
};
// ========================================================

console.log(
  `Apigee checkProductOverlap.js tool, version: ${version}\n` +
    `Node.js ${process.version}\n`
);

// process.argv array starts with 'node' and 'scriptname.js'
const opt = getopt.parse(process.argv.slice(2));

if (opt.options.verbose) {
  common.logWrite("start");
}

common.verifyCommonRequiredParameters(opt.options, getopt);

apigee
  .connect(common.optToOptions(opt))
  .then((org) => {
    const oneCred = gatherOneCredential(org);
    return org.apps
      .get({ expand: false })
      .then((result) => {
        //console.log(JSON.stringify(result, null, 2));
        const appIds = result.app.map((a) => a.appId);

        const reducer = (promise, item) =>
          promise.then((accumulator) =>
            org.apps
              .get({ id: item })
              .then((details) => [...accumulator, details])
          );

        return appIds.reduce(reducer, Promise.resolve([]));
      })
      .then((appList) => {
        if (opt.options.appname) {
          const re = new RegExp(opt.options.appname);
          return appList.filter((a) => a.name.match(re));
        }
        return appList;
      })
      .then((appList) =>
        Promise.all(
          appList.map((app) => {
            const credsWithMultipleApiProducts = app.credentials.filter(
              (item) => item.apiProducts.length > 1
            );

            return Promise.all(
              credsWithMultipleApiProducts.map(async (credential) => {
                const elaboratedProducts = await oneCred(credential);
                return {
                  app: app.name,
                  cred: credential.consumerKey,
                  products: credential.apiProducts.map((p) => p.apiproduct),
                  foundOverlaps: findOverlaps(elaboratedProducts)
                };
              })
            );
          })
        )
      )
      .then((result) => result.filter((item) => item.length));
  })
  .then((result) => result.flatMap((item) => item))
  .then((result) => {
    console.log(
      `App Credentials with multiple products${
        opt.options.appname
          ? " with app.name matching [" + opt.options.appname + "]"
          : ""
      }:`
    );
    console.log(JSON.stringify(result, null, 2) + "\n");
  })
  .catch((e) => console.error("error: " + util.format(e)));
