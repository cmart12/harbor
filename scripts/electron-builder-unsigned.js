const pkg = require('../package.json');

const config = JSON.parse(JSON.stringify(pkg.build));

if (config.win && config.win.azureSignOptions) {
  delete config.win.azureSignOptions;
}

module.exports = config;
