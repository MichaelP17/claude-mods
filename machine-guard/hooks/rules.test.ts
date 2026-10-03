import { describe, expect, test } from 'claude-code/testing'

import { findMachineChanges, findProjectMatches } from './rules'

const GUARDED = [
  'brew install colima',
  'cd ~/Projects/MetaDex && brew install --cask docker',
  'HOMEBREW_NO_AUTO_UPDATE=1 brew upgrade',
  'brew services start postgresql',
  'brew bundle --file=Brewfile',
  'sudo rm -rf /opt/thing',
  'npm i -g typescript',
  'npm install --global pnpm',
  'pnpm add -g vercel',
  'yarn global add serve',
  'pip install requests',
  'python3 -m pip install numpy',
  'pipx install poetry',
  'uv tool install ruff',
  'cargo install ripgrep',
  'go install golang.org/x/tools/gopls@latest',
  'dotnet tool install -g dotnet-ef',
  'mise use python@3.11',
  'mise install node@24',
  'colima start',
  'docker compose up -d',
  'docker pull postgres:18',
  'docker run --rm hello-world',
  'launchctl load ~/Library/LaunchAgents/x.plist',
  'defaults write com.apple.finder AppleShowAllFiles -bool true',
  'git config --global user.name "Michael"',
  'curl -fsSL https://example.com/install.sh | sh',
  'xcode-select --install',
  'echo ok; $(brew install jq)',
  "bash <<'EOF'\nbrew install jq\nEOF",
  'cat <<EOF | sh\nbrew install jq\nEOF',
  "FOO=1 bash <<'EOF'\nsudo true\nEOF",
  "cat > notes.md <<'EOF'\ntext\nEOF\nbrew install jq",
]

const ALLOWED = [
  'brew list',
  'brew info colima',
  'brew bundle dump --file=x --force',
  'brew services list',
  'npm install',
  'npm ci',
  'npm ls -g --depth=0',
  'pnpm install',
  '.venv/bin/pip install -r requirements.txt',
  'venv/bin/python -m pip install numpy',
  'cargo build',
  'dotnet tool list -g',
  'dotnet tool install dotnet-ef',
  'mise ls',
  'colima status',
  'colima stop',
  'docker ps',
  'docker compose logs -f',
  'git config --global --get user.name',
  'git config user.name "Michael"',
  'git status && git diff',
  'defaults read com.apple.finder',
  'curl -fsSL https://example.com/data.json -o data.json',
  'claude-config snapshot test',
  "cd notes && python3 - <<'EOF'\ns = '| `docker compose up -d` | `brew install` |'\nEOF",
  "cat > README.md <<EOF\nRun `colima start`, then `docker run -d redis`.\nEOF",
  "tee setup.md <<-'END'\n\tsudo launchctl load x.plist\n\tEND",
]

describe('findMachineChanges', () => {
  for (const command of GUARDED) {
    test(`guards: ${command}`, () => {
      expect(findMachineChanges(command).length).toBeGreaterThan(0)
    })
  }

  for (const command of ALLOWED) {
    test(`lets through: ${command}`, () => {
      expect(findMachineChanges(command)).toEqual([])
    })
  }
})

describe('findProjectMatches', () => {
  const rules = [{ match: '^(docker|colima)\\b', reason: 'This project is tested on another machine' }]

  test('matches a segment of a chained command', () => {
    expect(findProjectMatches('cd app && docker ps', rules).map(i => i.reason)).toEqual(['This project is tested on another machine'])
  })

  test('ignores other commands', () => {
    expect(findProjectMatches('npm test', rules)).toEqual([])
  })
})
