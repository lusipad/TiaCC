# Contributing

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh.md)

Thanks for your interest in TiaCC! We welcome contributions of all kinds.

## How to contribute

### Report bugs

1. Check existing issues to avoid duplicates
2. Open a new issue using the bug template
3. Provide clear reproduction steps and environment details

### Request features

1. Search for similar feature requests
2. Open a new issue describing the desired behavior
3. Explain the use case and expected outcome

### Submit code

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m "feat: ..."` )
4. Push the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Development setup

### Prerequisites

- .NET SDK 10 (see `global.json`)
- Clang 14+ (for C++ coverage)
- CMake 3.20+

### Build & test

```bash
git clone https://github.com/lusipad/TiaCC.git
cd TiaCC

dotnet build src/TiaCC.DotNet.sln
dotnet test src/TiaCC.DotNet.sln
```

### Run end-to-end tests

```powershell
cd tests/e2e/cpp-project
./run_e2e_test.ps1
```

## Coding style

### C#

- Follow `.editorconfig` and .NET conventions
- Document public APIs with XML docs where appropriate

```bash
dotnet format src/TiaCC.DotNet.sln
```

### C++

- Use `clang-format` following the repo’s `.clang-format`

## Commit message format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Common types:

- `feat`: features
- `fix`: bug fixes
- `docs`: documentation
- `style`: formatting only
- `refactor`: refactors
- `test`: tests
- `chore`: tooling/build

Example:

```
feat(mapper): add support for LLVM JSON format

Add LlvmJsonCoverageParser to parse pre-processed LLVM JSON files
exported via `llvm-cov export`.

Closes #123
```

## Project layout

```
TiaCC/
├── src/                      # source code
│   ├── core/cpp/             # C++ core / coverage
│   ├── core/dotnet/          # .NET core library
│   ├── cli/dotnet/           # .NET CLI (global tool)
│   ├── dashboard/dotnet/     # Blazor Dashboard
│   ├── collectors/           # coverage collectors
│   └── clients/              # test framework clients
├── scripts/                  # repo scripts
├── tests/
│   └── e2e/                  # end-to-end tests
├── docs/                     # docs
└── global.json               # .NET SDK version
```

## Adding new features

### Add a new coverage format

1. Add a new parser under `src/core/dotnet/TiaCC.Core`
2. Implement parsing logic
3. Wire it into the CLI
4. Add unit tests

### Add a new test framework client

1. Create a new client under `src/clients/`
2. Implement coverage collection hooks
3. Provide `beforeTest/afterTest` hooks
4. Document usage

## Releases

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: breaking changes
- **MINOR**: backward-compatible features
- **PATCH**: backward-compatible fixes

## Contact

- Issues: GitHub Issues
- Email: `maintainer@example.com`

Thanks again for contributing!
