#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function createStandalone() {
  // Read the main HTML file
  const htmlPath = 'out/index.html';
  let html = fs.readFileSync(htmlPath, 'utf8');
  
  // Read the CSS file
  const cssPath = 'out/_next/static/css/1373ca8cf4921f19.css';
  const css = fs.readFileSync(cssPath, 'utf8');
  
  // Replace the CSS link with inline styles
  const cssLinkRegex = /<link rel="stylesheet" href="\.?\/_next\/static\/css\/[^"]+\.css"[^>]*>/;
  const inlineCSS = `<style>${css}</style>`;
  
  html = html.replace(cssLinkRegex, inlineCSS);
  
  // Remove font preloads that might cause issues
  html = html.replace(/<link rel="preload" href="[^"]*\.woff2"[^>]*>/g, '');
  
  // Write the standalone file
  const standalonePath = 'out/standalone.html';
  fs.writeFileSync(standalonePath, html);
  
  console.log(`Created standalone HTML file: ${standalonePath}`);
  console.log('This file should work with file:// protocol');
}

createStandalone();