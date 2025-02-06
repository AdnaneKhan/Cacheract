module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/test/**/*.test.ts'],
    moduleNameMapper: {
      'assets.*\\.(py|yml)$': '<rootDir>/test/resources/fileMock.js'
    }
  };