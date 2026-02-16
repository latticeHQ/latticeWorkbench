#!/usr/bin/env bash
# Generate built-in skill and plugin pack content:
#   - src/node/services/agentSkills/builtInSkillContent.generated.ts
#   - src/node/services/pluginPacks/builtInPluginRegistry.generated.ts

set -euo pipefail

if command -v bun >/dev/null 2>&1; then
  bun scripts/gen_builtin_skills.ts
  bun scripts/gen_builtin_plugins.ts
else
  npx tsx scripts/gen_builtin_skills.ts
  npx tsx scripts/gen_builtin_plugins.ts
fi

echo "Generated src/node/services/agentSkills/builtInSkillContent.generated.ts"
echo "Generated src/node/services/pluginPacks/builtInPluginRegistry.generated.ts"
