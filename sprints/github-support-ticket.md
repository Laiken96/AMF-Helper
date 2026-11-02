# GitHub Support Ticket: scheduled workflows not triggering

Formular: https://support.github.com/contact (Kategorie Actions). Text auf Englisch, weil der Support englisch arbeitet.

---

**Subject:** Cron schedule never triggers in Laiken96/AMF-Helper, manual runs work

**Body:**

Hello GitHub Support,

scheduled workflows in my public repository Laiken96/AMF-Helper do not trigger reliably. One workflow has never run on schedule, even though manual runs via workflow_dispatch succeed every time.

Repository: https://github.com/Laiken96/AMF-Helper (public, GitHub Free, personal account)
Default branch: main

Affected workflow, never triggered by schedule:
- .github/workflows/push.yml (workflow id 404093004), state active
- cron: "4,14,24,34,44,54 * * * *" (until 2026-11-02 10:53 UTC it was "3,13,23,33,43,53 * * * *")
- Successful manual run: 41384349660 (workflow_dispatch, 2026-11-02 03:40 UTC)

Second workflow, triggered by schedule only once after many hours:
- .github/workflows/data.yml (workflow id 404051451), state active
- cron: "17 * * * *"
- On main since about 2026-11-02 03:00 UTC. No scheduled run until 11:24 UTC (run 41436557517, success). The runs expected at 03:17 to 10:17 UTC never appeared.

Timeline (UTC, 2026-11-02):
- 01:44 repository created
- about 03:00 default branch set to main, Pages enabled
- 03:07 to 04:57 several pushes to main, including the workflow files
- 05:30 manual workflow_dispatch of data.yml succeeds
- 10:53 cron line in push.yml edited and committed directly on main by me to force re-registration
- 11:24 first and only scheduled run (data.yml)
- push.yml: zero scheduled runs at all, 0 of more than 40 expected slots

What I checked:
- Repository is public, not a fork, Actions enabled with "Allow all actions and reusable workflows"
- All workflows show state "active" via the REST API
- Workflow files are valid, manual runs succeed
- Cron expressions avoid minute 0
- Recent commits exist on the default branch, so the 60 day inactivity rule does not apply

Could you please check whether the schedules of this repository are registered correctly on your side and whether there is a limit or a known issue for new repositories or for 10 minute intervals? Several community discussions report the same behaviour (for example community discussions 201436, 208729 and 210326).

Thank you
Jacques Aellig (Laiken96)
