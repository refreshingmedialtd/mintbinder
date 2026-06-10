module.exports = {
  apps: [
    {
      name: "MintBinder",
      cwd: "/home/virtual/vps-05742c/0/0ddcd8e9a0/mintbinder",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
      },
      exp_backoff_restart_delay: 100,
    },
  ],
};
