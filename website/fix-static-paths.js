#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');

function fixPaths() {
  // Fix HTML files
  const htmlFiles = glob.sync('out/**/*.html');
  htmlFiles.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    // Fix all _next paths to be relative
    content = content.replace(/"\/_next\//g, '"./_next/');
    content = content.replace(/'\/_next\//g, "''./_next/");
    
    fs.writeFileSync(file, content);
    console.log(`Fixed HTML: ${file}`);
  });
  
  // Fix CSS files
  const cssFiles = glob.sync('out/**/*.css');
  cssFiles.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    // Fix font paths and other asset paths
    content = content.replace(/url\(\/_next\//g, 'url(./_next/');
    
    fs.writeFileSync(file, content);
    console.log(`Fixed CSS: ${file}`);
  });
  
  // Fix JS files
  const jsFiles = glob.sync('out/**/*.js');
  jsFiles.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    // Fix paths in JS files
    content = content.replace(/"\/_next\//g, '"./_next/');
    content = content.replace(/'\/_next\//g, "'./_next/");
    
    fs.writeFileSync(file, content);
    console.log(`Fixed JS: ${file}`);
  });
  
  console.log('All paths fixed for static file protocol!');
}

fixPaths();