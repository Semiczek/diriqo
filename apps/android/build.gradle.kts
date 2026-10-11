plugins { id("com.android.application") version "9.3.0" apply false }

// Optional local build root avoids file-lock conflicts in synced workspaces.
providers.environmentVariable("DIRIQO_ANDROID_BUILD_ROOT").orNull?.let { buildRoot ->
    layout.buildDirectory.set(file("$buildRoot/root"))
    subprojects { layout.buildDirectory.set(file("$buildRoot/${project.name}")) }
}
