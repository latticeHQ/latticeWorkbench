{
  "targets": [{
    "target_name": "lattice_spawn",
    "sources": ["src/lattice_spawn.mm"],
    "include_dirs": [
      "<!@(node -e \"console.log(require('path').dirname(require.resolve('node-addon-api/package.json')))\")"
    ],
    "cflags!": ["-fno-exceptions"],
    "cflags_cc!": ["-fno-exceptions"],
    "defines": [
      "NAPI_DISABLE_CPP_EXCEPTIONS",
      "NODE_ADDON_API_DISABLE_DEPRECATED"
    ],
    "conditions": [
      ["OS=='mac'", {
        "xcode_settings": {
          "GCC_ENABLE_OBJC_ARC": "YES",
          "CLANG_ENABLE_OBJC_ARC": "YES",
          "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-fvisibility=hidden"],
          "MACOSX_DEPLOYMENT_TARGET": "11.0",
          "OTHER_LDFLAGS": ["-framework Foundation"]
        },
        "libraries": ["-framework Foundation"]
      }]
    ]
  }]
}
