package {{ package_name }}.di

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * App-wide Hilt module. Add @Provides functions here for things every
 * feature needs a single shared instance of (Retrofit, Room database,
 * DataStore, ...).
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    // Example:
    // @Provides
    // @Singleton
    // fun provideRetrofit(): Retrofit = Retrofit.Builder()
    //     .baseUrl("https://api.example.com/")
    //     .build()
}