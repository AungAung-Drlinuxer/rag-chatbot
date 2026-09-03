# Push the SSH-setup commit to Gitea (one-time interactive, then cached)

Open Git Bash / terminal in D:\ragchatbot and run:

    git push gitea dev

Git Credential Manager (already installed) will pop up a login window the first
time — sign in there with:

    Username: ithadmin
    Password: <your NEW password — rotated in the UI>

After that one push, credentials are stored and future pushes work silently.
(Automated runs from the agent can't complete this interactive step — the old
temporary password was invalidated by your password rotation, which is correct
behaviour.)
