# Launch Kit

Use this page to share Repo Health Doctor and collect useful feedback.

## Links

- GitHub: https://github.com/yuanzhecheng17-collab/repo-health-doctor
- npm: https://www.npmjs.com/package/repo-health-doctor
- Install: `npx repo-health-doctor .`

## One-Line Pitch

Repo Health Doctor is a zero-dependency CLI that scores whether a repository is ready to publish on GitHub.

## Short Description

Repo Health Doctor checks README, license, tests, CI, dependency metadata, env-file hygiene, and obvious secret patterns. It works locally or in CI and returns a simple publish-readiness score.

## Copy-Paste Posts

### X / Threads

```text
I built Repo Health Doctor, a zero-dependency CLI that scores whether a repository is ready to publish on GitHub.

It checks README, license, tests, CI, env-file hygiene, and obvious secret patterns.

Try it:
npx repo-health-doctor .

GitHub: https://github.com/yuanzhecheng17-collab/repo-health-doctor
```

### Hacker News / Reddit

```text
Show HN: Repo Health Doctor, a zero-dependency CLI for repository readiness checks

I built a small CLI that scores whether a repo is ready to publish on GitHub. It checks for README, license, test signals, CI config, dependency metadata, env-file hygiene, and obvious secret patterns.

It does not read private .env file contents. It only reports their file names and scans ordinary text files for risky secret patterns.

Install:
npx repo-health-doctor .

GitHub: https://github.com/yuanzhecheng17-collab/repo-health-doctor
npm: https://www.npmjs.com/package/repo-health-doctor

I would appreciate feedback on which checks should be added next.
```

### V2EX / Juejin

```text
我做了一个小工具 Repo Health Doctor，用来检查一个仓库是否适合公开发布到 GitHub。

它会检查 README、LICENSE、测试、CI、依赖元数据、.env 文件卫生，以及明显的 secret 风险，最后给出 0-100 分。

直接运行：
npx repo-health-doctor .

GitHub: https://github.com/yuanzhecheng17-collab/repo-health-doctor
npm: https://www.npmjs.com/package/repo-health-doctor

欢迎提建议：你觉得开源项目发布前还应该检查什么？
```

## Launch Checklist

- Post the GitHub link with the demo GIF.
- Ask one specific feedback question, such as "Which repository checks should be added next?"
- Reply to every useful comment within 24 hours.
- Turn repeated feedback into GitHub issues.
- Ship one small improvement within a week of launch.

## Feedback Questions

- Which checks are missing for your stack?
- Should the score be configurable?
- Would SARIF output be useful for GitHub code scanning?
- Should this become a GitHub Action wrapper?
- Would you use this in CI or only locally?
