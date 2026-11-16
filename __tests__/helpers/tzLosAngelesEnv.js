// Jest environment that runs a test file in the America/Los_Angeles timezone (UTC-8 in winter).
//
// Use it with a docblock at the top of a test file:
//     /** @jest-environment <rootDir>/__tests__/helpers/tzLosAngelesEnv.js */
//
// Why an environment and not `process.env.TZ = ...` inside the test: `process.env` inside a Jest test file is a
// COPY of the real one, so assigning TZ there never reaches Node and dates keep the machine's timezone. The real
// process must change BEFORE the sandbox is created, which is what this constructor does. It is put back on
// teardown so other test files running in the same worker are unaffected.
//
// Extends the same environment the jest-expo / react-native preset uses.

const ReactNativeEnv = require('react-native/jest/react-native-env.js');

const TIMEZONE = 'America/Los_Angeles';

module.exports = class LosAngelesEnv extends ReactNativeEnv {
  constructor(config, context) {
    const previous = process.env.TZ;
    process.env.TZ = TIMEZONE;
    super(config, context);
    this.previousTimezone = previous;
  }

  async teardown() {
    if (this.previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = this.previousTimezone;
    await super.teardown();
  }
};
