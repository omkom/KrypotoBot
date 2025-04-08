// src/api/instance-manager.js

import fs from 'fs';
import { execSync } from 'child_process';

const MAX_INSTANCES = parseInt(process.env.MAX_CONCURRENT_INSTANCES || '5', 10);
const LOG_DIR = process.env.BASE_LOG_DIR || '/app/logs/instances';
const DEBUG = process.env.DEBUG_MODE === 'true';

function log(msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [InstanceManager] ${msg}`);
}

function listRunningInstances() {
  const output = execSync('docker ps --format "{{.Names}}"').toString();
  return output.split('\n').filter(name => name.startsWith('memecoin-instance-'));
}

function manageInstances() {
  const running = listRunningInstances();

  if (DEBUG) log(`Instances actives détectées : ${running.length}`);

  if (running.length > MAX_INSTANCES) {
    const toStop = running.slice(MAX_INSTANCES);
    toStop.forEach(name => {
      log(`🛑 Arrêt de l'instance ${name}`);
      execSync(`docker stop ${name}`);
    });
  }

  if (running.length < MAX_INSTANCES) {
    const toStart = MAX_INSTANCES - running.length;
    for (let i = 0; i < toStart; i++) {
      const newName = `memecoin-instance-${Date.now()}-${i}`;
      log(`🚀 Lancement de ${newName}`);
      execSync(`docker run -d --name ${newName} memecoin-trading-core`);
    }
  }
}

function loop() {
  log(`Instance Manager lancé. MAX_INSTANCES = ${MAX_INSTANCES}`);
  setInterval(manageInstances, 15000);
}

loop();
