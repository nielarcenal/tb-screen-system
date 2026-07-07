module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo includes Expo Router support (SDK 50+).
  return { presets: ['babel-preset-expo'] };
};
