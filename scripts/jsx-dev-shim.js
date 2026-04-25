// Shim: map react/jsx-dev-runtime's jsxDEV to react/jsx-runtime's jsx.
// Needed because documint is built with Bun which emits jsxDEV calls,
// but React 19's production jsx-dev-runtime sets jsxDEV = undefined.
const runtime = require('react/jsx-runtime');
exports.jsxDEV = function(type, props, key) {
  return runtime.jsx(type, props, key);
};
exports.Fragment = runtime.Fragment;
