package {{ package_name }}.di

import org.koin.dsl.module


//private const val RMAPI_URL = "http://98.66.234.231:8000/api/"
/**
 * Koin dependency injection module for the application.
 *
 * This module defines all the dependencies that will be available for injection
 * throughout the application. It configures how dependencies are created and
 * their lifecycle (singleton, factory, etc.).
 *
 * ## Usage
 * This module should be loaded when initializing the Koin container in the application.
 *
 * @see org.koin.dsl.module
 * @see single
 * @see factory
 *
 * @sample
 * // Initialize Koin with this module
 * startKoin {
 *     modules(appModule)
 * }
 */
val appModule = module {
    //single<HttpClient> {
    //    createHttpClient(
    //        baseUrl = RMAPI_URL
    //    )
    //}

    // Single instance (singleton) of LoginService
    // single { LoginAPI(get()) }
    // single<LoginRepository> { LoginRepositoryImpl(get()) }
}