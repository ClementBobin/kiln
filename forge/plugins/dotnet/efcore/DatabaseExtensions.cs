namespace {{root_namespace}}.Extensions;

using {{root_namespace}}.Interceptors;

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

/// <summary>
/// Enregistre {{ database_count }} DbContext(s) EF Core, chacun avec l'intercepteur de requêtes lentes.
/// Le nombre de bases est piloté par la variable de plugin <c>database_count</c> — augmentez-la pour
/// enregistrer plusieurs bases de données (ex. une base "métier" + une base "reporting").
/// </summary>
public static class DatabaseExtensions
{
    public static IServiceCollection AddDatabase(this IServiceCollection services,
        IConfiguration config, IWebHostEnvironment env)
    {
        services.AddSingleton<EfSlowQueryInterceptor>();

{% set count = database_count | int %}
{% for i in range(1, count + 1) %}
{% set suffix = "" if count == 1 else i %}
        services.AddDbContext<{{ db_context_prefix }}{{ suffix }}DbContext>((sp, options) =>
        {
            options.AddInterceptors(sp.GetRequiredService<EfSlowQueryInterceptor>());

            var provider{{ i }} = config["DatabaseProvider{{ suffix }}"] ?? "{{ database_provider }}";
            if (provider{{ i }}.Equals("postgres", StringComparison.OrdinalIgnoreCase))
                options.UseNpgsql(config.GetConnectionString("{{ connection_string_prefix }}{{ suffix }}"));
            else
                options.UseSqlite(config.GetConnectionString("{{ connection_string_prefix }}{{ suffix }}"));

            options.ConfigureWarnings(w =>
                w.Ignore(RelationalEventId.PendingModelChangesWarning));
        });
{% endfor %}

        return services;
    }
}
