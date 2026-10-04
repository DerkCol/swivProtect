plugins { id("com.android.application") }

android {
    namespace = "com.swivel.swivprotect.sms"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.swivel.swivprotect.sms"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
