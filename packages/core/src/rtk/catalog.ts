/** Pinned RTK built-in inventory; Apache-2.0, see third-party/rtk/LICENSE. */
export const RTK_REVISION = 'f7495466edf7d2ed93d6ea4d2caab18dc8806b5a'
export const RTK_FILTER_IDS = [
  "rtk/ansible-playbook",
  "rtk/basedpyright",
  "rtk/biome",
  "rtk/brew-install",
  "rtk/bundle-install",
  "rtk/composer-install",
  "rtk/df",
  "rtk/dotnet-build",
  "rtk/du",
  "rtk/fail2ban-client",
  "rtk/gcc",
  "rtk/gcloud",
  "rtk/gradle",
  "rtk/hadolint",
  "rtk/helm",
  "rtk/iptables",
  "rtk/jira",
  "rtk/jj",
  "rtk/jq",
  "rtk/just",
  "rtk/liquibase",
  "rtk/make",
  "rtk/markdownlint",
  "rtk/mise",
  "rtk/mix-compile",
  "rtk/mix-format",
  "rtk/nx",
  "rtk/ollama",
  "rtk/oxlint",
  "rtk/ping",
  "rtk/pio-run",
  "rtk/poetry-install",
  "rtk/pre-commit",
  "rtk/ps",
  "rtk/pulumi-destroy",
  "rtk/pulumi-preview",
  "rtk/pulumi-refresh",
  "rtk/pulumi-stack",
  "rtk/pulumi-up",
  "rtk/quarto-render",
  "rtk/rsync",
  "rtk/shellcheck",
  "rtk/shopify-theme",
  "rtk/skopeo",
  "rtk/sops",
  "rtk/spring-boot",
  "rtk/ssh",
  "rtk/stat",
  "rtk/swift-build",
  "rtk/systemctl-status",
  "rtk/task",
  "rtk/terraform-plan",
  "rtk/tofu-fmt",
  "rtk/tofu-init",
  "rtk/tofu-plan",
  "rtk/tofu-validate",
  "rtk/trunk-build",
  "rtk/turbo",
  "rtk/ty",
  "rtk/uv-sync",
  "rtk/xcodebuild",
  "rtk/yadm",
  "rtk/yamllint"
] as const
export const RTK_CATALOG = [
  {
    "id": "rtk/ansible-playbook",
    "file": "ansible-playbook.toml",
    "sha256": "5a6c880f1baf60399b4afece9eb2f0761e599bb1cb050dbf8c4cc4a57527c7e2",
    "description": "Compact ansible-playbook output"
  },
  {
    "id": "rtk/basedpyright",
    "file": "basedpyright.toml",
    "sha256": "f6df2dfffb311a193194d74f8a536dd006913c038b97af20d1aa301400eeb410",
    "description": "Compact basedpyright type checker output — strip blank lines, keep errors"
  },
  {
    "id": "rtk/biome",
    "file": "biome.toml",
    "sha256": "b476a13b4cf253c4aa4968cf5192ef3e61b352ee2db0a4f054bdc09ec5d4b04b",
    "description": "Compact Biome lint/format output — strip blank lines, keep diagnostics"
  },
  {
    "id": "rtk/brew-install",
    "file": "brew-install.toml",
    "sha256": "9ce35afac31248db32e2033a88bfb32ae9d64ce4700a4c9faa0effb490bbafdf",
    "description": "Compact brew install/upgrade output — strip downloads, short-circuit when already installed"
  },
  {
    "id": "rtk/bundle-install",
    "file": "bundle-install.toml",
    "sha256": "f9bdea56d32f4cb94388226ec53a49ffec458ac3f887895ca2aebd2da81d37a3",
    "description": "Compact bundle install/update — strip 'Using' lines, keep installs and errors"
  },
  {
    "id": "rtk/composer-install",
    "file": "composer-install.toml",
    "sha256": "e3c53ea5d13c8eb06bfcec2952f55346dce4a41732bb85bd5665aa24c2a25d31",
    "description": "Compact composer install/update/require output — strip downloads, short-circuit when up-to-date"
  },
  {
    "id": "rtk/df",
    "file": "df.toml",
    "sha256": "6c496a1559cd22ce8227f6ba5e88c48ba9e06e92fccdbb3ca5c128bd3dd1d532",
    "description": "Compact df output — truncate wide columns, limit rows"
  },
  {
    "id": "rtk/dotnet-build",
    "file": "dotnet-build.toml",
    "sha256": "32941a4c4b21e6f54f4f2fbe012b61ac491f69e5cbba142fe77579851f52a4aa",
    "description": "Compact dotnet build output — short-circuit on success, strip banners"
  },
  {
    "id": "rtk/du",
    "file": "du.toml",
    "sha256": "cb363ec3e163c6fed016339d3adeb9b3c36bedb3b7d1ae3501a78b049e8ef595",
    "description": "Compact du output"
  },
  {
    "id": "rtk/fail2ban-client",
    "file": "fail2ban-client.toml",
    "sha256": "66a46d62819254bc9e26db95dc51a403e54fc6e089168a6c5ef0bb514e559fd9",
    "description": "Compact fail2ban-client output"
  },
  {
    "id": "rtk/gcc",
    "file": "gcc.toml",
    "sha256": "1d0d719ee01fa0f5e23ddfcbd3b02b47ece743cf61af335e26f313b3faca617c",
    "description": "Compact gcc/g++ compiler output — strip notes, keep errors and warnings"
  },
  {
    "id": "rtk/gcloud",
    "file": "gcloud.toml",
    "sha256": "30bb8ccb7b5a642a17c68545612707ddec801e9c0cb980e190c40fcf0bbaff91",
    "description": "Compact gcloud output"
  },
  {
    "id": "rtk/gradle",
    "file": "gradle.toml",
    "sha256": "f9b6d2425ab183df2083e6bf13c694d6072c2b90f0763e11c268934f7cb42080",
    "description": "Compact Gradle build output — strip progress, keep tasks and errors"
  },
  {
    "id": "rtk/hadolint",
    "file": "hadolint.toml",
    "sha256": "51575715ef665ea55e57219d784e38336d2c6924829a0abb52062f2a78aa8a22",
    "description": "Compact hadolint Dockerfile linting output"
  },
  {
    "id": "rtk/helm",
    "file": "helm.toml",
    "sha256": "a29171e30f1e2a41f9f82616bf00a3430b2c66052dbb5c897342406777bf76c0",
    "description": "Compact helm output"
  },
  {
    "id": "rtk/iptables",
    "file": "iptables.toml",
    "sha256": "0b2802aab90ccd03e9c1d674e8cd49f04861bb5b7bc34aef4a92ea659222563e",
    "description": "Compact iptables output"
  },
  {
    "id": "rtk/jira",
    "file": "jira.toml",
    "sha256": "9557fa46444e0308c36ec1cb5e735ddb043cc841330ba0ac0cb58f6ef2d1e454",
    "description": "Compact Jira CLI output — strip verbose metadata, keep essentials"
  },
  {
    "id": "rtk/jj",
    "file": "jj.toml",
    "sha256": "da5cc860cd564a38169b404a4ab3d55c4e91154c90083da364cacc7549f48a8a",
    "description": "Compact Jujutsu (jj) output — strip blank lines, truncate"
  },
  {
    "id": "rtk/jq",
    "file": "jq.toml",
    "sha256": "fec22286464e3c66229d784febc3ba51d0d6f98f907af18f28930fa997980b98",
    "description": "Compact jq output — truncate large JSON results"
  },
  {
    "id": "rtk/just",
    "file": "just.toml",
    "sha256": "3ab46b21148ebf4af210200d408515c12ebb5f6590b14048db8af31ba5b2923e",
    "description": "Compact just task runner output — strip recipe headers, keep command output"
  },
  {
    "id": "rtk/liquibase",
    "file": "liquibase.toml",
    "sha256": "5fac9073de0e1e9c897eed522ffe487bba66afa5d37fbfd2b06e35ebed75bf94",
    "description": "Compact liquibase output — strip headers and generic info"
  },
  {
    "id": "rtk/make",
    "file": "make.toml",
    "sha256": "0d2f67f2e2fd4820853e998f7ca2bf9445ffa6632642d10b15a681e9f5c36614",
    "description": "Compact make output"
  },
  {
    "id": "rtk/markdownlint",
    "file": "markdownlint.toml",
    "sha256": "827cf11614d4dca4d64563060e6665ce135b01d61ebb86621ba8af12ea04dbd9",
    "description": "Compact markdownlint output — strip blank lines, limit rows"
  },
  {
    "id": "rtk/mise",
    "file": "mise.toml",
    "sha256": "5a416be11bdb8ea5ea1d06c47e9c96920ecea1e57d8fb17956f6a2cbc1e0d192",
    "description": "Compact mise task runner output — strip status lines, keep task results"
  },
  {
    "id": "rtk/mix-compile",
    "file": "mix-compile.toml",
    "sha256": "4167205058fecc76f43d26bf71a7b904b5d553ed81216732fa4dcac51763cd6c",
    "description": "Compact mix compile output"
  },
  {
    "id": "rtk/mix-format",
    "file": "mix-format.toml",
    "sha256": "f5be87d80dd5d8a0276a101bc5c8bad16662d4b58c4c691f6e3561e1db427cc6",
    "description": "Compact mix format output"
  },
  {
    "id": "rtk/nx",
    "file": "nx.toml",
    "sha256": "dde44afaf6026c8b4ce912e7c8f61a0f2890eb52b8245169a2766306910ae562",
    "description": "Compact Nx monorepo output — strip task graph noise, keep results"
  },
  {
    "id": "rtk/ollama",
    "file": "ollama.toml",
    "sha256": "bf2898bffa2fbbf8a7945c344abf52d3a760dce67f28113bd26bba031836088c",
    "description": "Strip ANSI spinners and cursor control from ollama output, keep final text"
  },
  {
    "id": "rtk/oxlint",
    "file": "oxlint.toml",
    "sha256": "4cdd71f51128e588f0abb100e4e61c8ff4f2a7906383b90cf3b821d9c0532488",
    "description": "Compact oxlint output — strip blank lines, keep diagnostics"
  },
  {
    "id": "rtk/ping",
    "file": "ping.toml",
    "sha256": "a22fd6e62016c3846eed832bfb0213d4a91f4ae976b204ac03817c99acc6c970",
    "description": "Compact ping output — strip per-packet lines, keep summary"
  },
  {
    "id": "rtk/pio-run",
    "file": "pio-run.toml",
    "sha256": "69c8f9040d87383787db76db6ea071523cb8f370c0f00374126a2e6119f96761",
    "description": "Compact PlatformIO build output"
  },
  {
    "id": "rtk/poetry-install",
    "file": "poetry-install.toml",
    "sha256": "ebff2dac219dc7b86b8ddeeb9dd37d12fa91c9b81368e58ba06aa25242019b3b",
    "description": "Compact poetry install/lock/update output — strip downloads, short-circuit when up-to-date"
  },
  {
    "id": "rtk/pre-commit",
    "file": "pre-commit.toml",
    "sha256": "02446f5d004d999f762f791c468dc8b2808e3bdcb5bfdd03dd7e07bc6c695305",
    "description": "Compact pre-commit output"
  },
  {
    "id": "rtk/ps",
    "file": "ps.toml",
    "sha256": "325d04ccee15075c02feb2ee63ecc08763bc253a2fb55b48bb08432bd527bcb5",
    "description": "Compact ps output — truncate wide lines, limit rows"
  },
  {
    "id": "rtk/pulumi-destroy",
    "file": "pulumi-destroy.toml",
    "sha256": "115a118816320f93fec2f976a277e47f731f618f5faa6a2ba44f92a3040a7b7b",
    "description": "Compact Pulumi destroy output"
  },
  {
    "id": "rtk/pulumi-preview",
    "file": "pulumi-preview.toml",
    "sha256": "b72c409df7103acac6a8cb881c96820a1370bc2fc048cfc8b3aefa85b0b025ed",
    "description": "Compact Pulumi preview output"
  },
  {
    "id": "rtk/pulumi-refresh",
    "file": "pulumi-refresh.toml",
    "sha256": "47d215de95ea56d14e21028cbbe582da6d65a1a0e7464e69f45d0d705b2b7e13",
    "description": "Compact Pulumi refresh (state reconciliation) output"
  },
  {
    "id": "rtk/pulumi-stack",
    "file": "pulumi-stack.toml",
    "sha256": "4e0034b23a74b9660f11c307fca35de21b306b6a8af498867ca8905eca641993",
    "description": "Compact Pulumi stack (ls/output) output"
  },
  {
    "id": "rtk/pulumi-up",
    "file": "pulumi-up.toml",
    "sha256": "09afaf8881c6cd44b6d09f36897c9eba90fbff075242db00b0d1824a3cc51a2a",
    "description": "Compact Pulumi up (apply) output"
  },
  {
    "id": "rtk/quarto-render",
    "file": "quarto-render.toml",
    "sha256": "cac51eb69380935db3e75b7138af009c3225e14f56b5080e068bb5fb009f9a84",
    "description": "Compact quarto render output"
  },
  {
    "id": "rtk/rsync",
    "file": "rsync.toml",
    "sha256": "abf8979dcef021d69b6ff2fc49df55127b80232bc93ee1c5bda862f4aa851d39",
    "description": "Compact rsync output — short-circuit on success, strip progress"
  },
  {
    "id": "rtk/shellcheck",
    "file": "shellcheck.toml",
    "sha256": "aacca530bb613df62fe73cf01a428b1a0e7828c7098939ee6aec1428bea7f4e4",
    "description": "Compact shellcheck output — strip blank lines, keep caret indicators for error position"
  },
  {
    "id": "rtk/shopify-theme",
    "file": "shopify-theme.toml",
    "sha256": "cb49b6fef970e22e95f72b1cf6a4bd0af518c904c1ef998d08f285bf770d7ac7",
    "description": "Compact shopify theme push/pull output"
  },
  {
    "id": "rtk/skopeo",
    "file": "skopeo.toml",
    "sha256": "a9347ce2a4d0f43aa2b19eaae43f93a3d69a951c7657210e1a0547c14847f032",
    "description": "Compact skopeo output — truncate large manifests, strip verbosity"
  },
  {
    "id": "rtk/sops",
    "file": "sops.toml",
    "sha256": "5c400d57fda6db0f7a69d567aa0aaa28be3a680c2266da79b9f7e6f46b60905a",
    "description": "Compact sops output"
  },
  {
    "id": "rtk/spring-boot",
    "file": "spring-boot.toml",
    "sha256": "41c8ef73ae1336d79e317219f8c6c1d6b271be17f9523e85f28c97271e489eca",
    "description": "Compact Spring Boot output — strip banner and verbose startup logs, keep key events. Matches gradle bootRun, and java -jar only when the jar filename itself contains \"spring\" (mvn spring-boot:run is routed to RTK's dedicated Maven filter and never reaches this one). Jars using the Maven/Gradle default <artifactId>-<version>.jar name, and jars under a path containing spaces, are deliberately left to full passthrough rather than risk misclassifying an unrelated tool."
  },
  {
    "id": "rtk/ssh",
    "file": "ssh.toml",
    "sha256": "f80964f50ff7345e622060c34ee1772dd3f8d468335a0f4a964a02a4067b7e05",
    "description": "Compact ssh output — strip connection banners, keep command output"
  },
  {
    "id": "rtk/stat",
    "file": "stat.toml",
    "sha256": "f3a9814c2bf2eded442bd6e66fedde4ae60dc0d3139bb96dd36ce360d5d1f189",
    "description": "Compact stat output — strip device/inode/birth noise"
  },
  {
    "id": "rtk/swift-build",
    "file": "swift-build.toml",
    "sha256": "1c397ddd29292ceef5a4615c0b744c10be77febcbb270767a9a9d9d7dd76eeab",
    "description": "Compact swift build output — short-circuit on success, strip Compiling/Linking"
  },
  {
    "id": "rtk/systemctl-status",
    "file": "systemctl-status.toml",
    "sha256": "6299897c067c39972712421d30c8faaa965673543360570c52f67bb2a0bbfe7a",
    "description": "Compact systemctl status output — strip blank lines, limit to 20 lines"
  },
  {
    "id": "rtk/task",
    "file": "task.toml",
    "sha256": "2151fdb559927059edd19c6fbc4311739faf4493f2b27817de9b38150e306e2f",
    "description": "Compact go-task output — strip task headers, keep command results"
  },
  {
    "id": "rtk/terraform-plan",
    "file": "terraform-plan.toml",
    "sha256": "3ff42a629aedf061de0ce33f41557072b13bed73f3d42fc2b51d4db18a3598d6",
    "description": "Compact Terraform plan output"
  },
  {
    "id": "rtk/tofu-fmt",
    "file": "tofu-fmt.toml",
    "sha256": "3c8731e0c1f764cc2fed3b4d0a4c2101813ec64d03ff8c68f8728ea5ebb976a1",
    "description": "Compact OpenTofu fmt output"
  },
  {
    "id": "rtk/tofu-init",
    "file": "tofu-init.toml",
    "sha256": "127abb8fbedd19f2b0f860c9733d44788a8ed11f423d0077cda447976f14df8f",
    "description": "Compact OpenTofu init output"
  },
  {
    "id": "rtk/tofu-plan",
    "file": "tofu-plan.toml",
    "sha256": "e444466da52ce184f3ff351ff9acdf71b4bbd1e230aea94e010c05dfb5c196a7",
    "description": "Compact OpenTofu plan output"
  },
  {
    "id": "rtk/tofu-validate",
    "file": "tofu-validate.toml",
    "sha256": "419c8acf53ee7160f43960ef4e7be10f1ecac72ad3f7490bab7743d923d4f909",
    "description": "Compact OpenTofu validate output"
  },
  {
    "id": "rtk/trunk-build",
    "file": "trunk-build.toml",
    "sha256": "f3634d9208ddd35f277b680eb7a34dd87b167346494c6aa3a37783cae40fd2f7",
    "description": "Compact trunk build output"
  },
  {
    "id": "rtk/turbo",
    "file": "turbo.toml",
    "sha256": "1a3c521e4b9d3ec68c5d5da746453de7d64ab671827101f510f00f7adc2a4353",
    "description": "Compact Turborepo output — strip cache status noise, keep task results"
  },
  {
    "id": "rtk/ty",
    "file": "ty.toml",
    "sha256": "233607e246349ca4ef50b73b081bf2138936381a6394f72eaa495cc9885b00c9",
    "description": "Compact ty type checker output — strip blank lines, keep errors"
  },
  {
    "id": "rtk/uv-sync",
    "file": "uv-sync.toml",
    "sha256": "1b78722bdca34d821dd7d721ffdeaf67c9d2e407d01dc78f48ab88e09c245d04",
    "description": "Compact uv sync/pip install output — strip downloads, short-circuit when up-to-date"
  },
  {
    "id": "rtk/xcodebuild",
    "file": "xcodebuild.toml",
    "sha256": "0fc3dc2d11ff554cdf2e58cefed56c4d9f2428b271dad328ecdd69d985412eec",
    "description": "Compact xcodebuild output — strip build phases, keep errors/warnings/summary"
  },
  {
    "id": "rtk/yadm",
    "file": "yadm.toml",
    "sha256": "1dc264e305d5ddac99aa803d34a5074702c154b02f5cf178ba57f8e3c10919ed",
    "description": "Compact yadm (git wrapper) output — same filtering as git"
  },
  {
    "id": "rtk/yamllint",
    "file": "yamllint.toml",
    "sha256": "3230ef732858c5a6d830d4f689501695ba5056f37e238c89096b19e4715705df",
    "description": "Compact yamllint output — strip blank lines, limit rows"
  }
] as const
