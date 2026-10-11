plugins { id("com.android.application") }

android {
    namespace = "com.diriqo.mobile"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-test"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    flavorDimensions += "audience"
    productFlavors {
        create("employee") {
            dimension = "audience"
            applicationId = "com.diriqo.my"
            resValue("string", "app_name", "My Diriqo")
            resValue("color", "brand", "#7C3AED")
            buildConfigField("boolean", "IS_MANAGER", "false")
            buildConfigField("String", "ENTRY_PATH", "\"/mobile/my\"")
        }
        create("manager") {
            dimension = "audience"
            applicationId = "com.diriqo.manager"
            resValue("string", "app_name", "Diriqo Manager")
            resValue("color", "brand", "#7C3AED")
            buildConfigField("boolean", "IS_MANAGER", "true")
            buildConfigField("String", "ENTRY_PATH", "\"/mobile/manager\"")
        }
    }
    buildFeatures { buildConfig = true; resValues = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    lint { abortOnError = true }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.5.0")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
}
