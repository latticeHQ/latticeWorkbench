// Dynamic Expo config.
//
// We intentionally keep iOS App Transport Security (ATS) strict for preview/production
// builds, but allow plain HTTP in *dev* builds so the app can talk to a local Lattice
// server (e.g. http://<lan-ip>:3000) without having to run TLS locally.
//
// EAS sets EAS_BUILD_PROFILE to the profile name (development|preview|production).

/** @type {import("@expo/config-types").ExpoConfig} */
const expoConfig = {
  name: "Lattice",
  slug: "lattice",
  version: "0.0.1",
  scheme: "lattice",
  orientation: "portrait",
  platforms: ["ios", "android"],
  newArchEnabled: true,
  jsEngine: "hermes",
  experiments: {
    typedRoutes: true,
  },
  extra: {
    lattice: {},
    router: {},
    eas: {
      projectId: "263dd3d7-ac12-491c-b530-73286b1f3b59",
    },
  },
  plugins: ["expo-router", "expo-secure-store"],
  ios: {
    bundleIdentifier: "com.lattice.mobile",
  },
  owner: "latticeruntime",
  android: {
    package: "com.lattice.mobile",
  },
};

/**
 * @param {import("@expo/config-types").ExpoConfig} config
 */
function withDevAtsException(config) {
  const ios = config.ios ?? {};
  const infoPlist = ios.infoPlist ?? {};
  const ats = infoPlist.NSAppTransportSecurity ?? {};

  return {
    ...config,
    ios: {
      ...ios,
      infoPlist: {
        ...infoPlist,
        NSAppTransportSecurity: {
          ...ats,
          NSAllowsArbitraryLoads: true,
        },
      },
    },
  };
}

module.exports = () => {
  const buildProfile = process.env.EAS_BUILD_PROFILE;
  const allowInsecureHttp = !buildProfile || buildProfile === "development";

  return allowInsecureHttp ? withDevAtsException(expoConfig) : expoConfig;
};
