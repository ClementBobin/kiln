/**
 * kotlin.runtime.ts
 *
 * Runtime engine for Android / Kotlin projects.
 *
 * Structure-based scaffolding creates the standard Android MVVM
 * directory layout (data/, di/, domain/, ui/) without needing Android Studio.
 * Source-based scaffolding (command / github) delegates to the base class.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BaseRuntimeEngine } from './base.runtime.js';
import type { ScaffoldEvent, KilnConfig } from '../../../types/index.js';

/** Flatten the structure's folder list into simple string names */
function flattenFolders(folders: (string | Record<string, unknown>)[]): string[] {
  return folders.flatMap((f) => {
    if (typeof f === 'string') return [f];
    return Object.keys(f);
  });
}

export class KotlinRuntimeEngine extends BaseRuntimeEngine {
  name = 'kotlin';

  protected async *handleStructure(
    config: KilnConfig,
    vars: Record<string, string>,
    outputDir: string
  ): AsyncGenerator<ScaffoldEvent> {
    const structure = config.structure as Record<string, any> | undefined;
    if (!structure || typeof structure !== 'object' || Array.isArray(structure)) {
      yield { status: 'error', message: 'kotlin runtime: config.structure must be a folder map' };
      return;
    }

    const packageName = vars['package_name'] ?? 'com.example.myapp';
    // Convert package name to a source path: com.example.myapp → com/example/myapp
    const packagePath = packageName.replace(/\./g, '/');
    const srcBase = path.join(outputDir, 'app', 'src', 'main', 'kotlin', packagePath);

    yield { status: 'running', message: `Creating Android MVVM directory layout` };

    // Create standard Gradle wrapper directories
    const gradleDirs = [
      path.join(outputDir, 'app', 'src', 'main', 'res', 'layout'),
      path.join(outputDir, 'app', 'src', 'main', 'res', 'values'),
      path.join(outputDir, 'app', 'src', 'test', 'kotlin', packagePath),
      path.join(outputDir, 'app', 'src', 'androidTest', 'kotlin', packagePath),
      path.join(outputDir, 'gradle', 'wrapper'),
    ];
    for (const d of gradleDirs) fs.mkdirSync(d, { recursive: true });

    // Walk the structure entries and create source folders
    for (const [layerName, details] of Object.entries(structure)) {
      const layerDir = path.join(srcBase, layerName.toLowerCase());

      if (details && typeof details === 'object' && !Array.isArray(details)) {
        const folderList: (string | Record<string, unknown>)[] = details.folders ?? [];
        const subFolders = flattenFolders(folderList);

        if (subFolders.length) {
          for (const sub of subFolders) {
            const subDir = path.join(layerDir, typeof sub === 'string' ? sub : Object.keys(sub)[0]);
            fs.mkdirSync(subDir, { recursive: true });
            fs.writeFileSync(path.join(subDir, '.gitkeep'), '');
          }
        } else {
          fs.mkdirSync(layerDir, { recursive: true });
          fs.writeFileSync(path.join(layerDir, '.gitkeep'), '');
        }
      } else {
        fs.mkdirSync(layerDir, { recursive: true });
        fs.writeFileSync(path.join(layerDir, '.gitkeep'), '');
      }

      yield { status: 'ok', message: `Created ${layerName}/ layer` };
    }

    // Write a minimal settings.gradle.kts
    const settingsGradle = `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${path.basename(outputDir)}"
include(":app")
`;
    fs.writeFileSync(path.join(outputDir, 'settings.gradle.kts'), settingsGradle);

    // Minimal app/build.gradle.kts
    const minSdk    = vars['min_sdk'] ?? '28';
    const targetSdk = vars['target_sdk'] ?? '34';
    const appBuildGradle = `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "${packageName}"
    compileSdk = ${targetSdk}

    defaultConfig {
        applicationId = "${packageName}"
        minSdk = ${minSdk}
        targetSdk = ${targetSdk}
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions { jvmTarget = "11" }

    buildFeatures { compose = true }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.retrofit)
    implementation(libs.retrofit.gson)
    implementation(libs.room.runtime)
    ksp(libs.room.compiler)
}
`;
    fs.mkdirSync(path.join(outputDir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'app', 'build.gradle.kts'), appBuildGradle);

    // Minimal AndroidManifest.xml
    const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.App">
        <activity
            android:name=".ui.MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`;
    fs.writeFileSync(path.join(outputDir, 'app', 'src', 'main', 'AndroidManifest.xml'), manifest);

    // strings.xml
    const projectLabel = path.basename(outputDir).replace(/[-_]/g, ' ');
    fs.writeFileSync(
      path.join(outputDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
      `<resources>\n    <string name="app_name">${projectLabel}</string>\n</resources>\n`
    );

    // .gitignore
    fs.writeFileSync(
      path.join(outputDir, '.gitignore'),
      `*.iml\n.gradle\n/local.properties\n/.idea\n.DS_Store\n/build\n/captures\n.externalNativeBuild\n.cxx\n`
    );

    yield { status: 'ok', message: 'Android project skeleton created' };
    yield { status: 'info', message: 'Open the project in Android Studio to sync Gradle and complete setup' };
  }
}
