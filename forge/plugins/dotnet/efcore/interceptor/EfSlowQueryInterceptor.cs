namespace {{root_namespace}}.Interceptors;

using System.Data.Common;
using System.Diagnostics;

using Configuration;

using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Options;

/// <summary>
/// Intercepteur EF Core qui journalise uniquement les commandes SQL dépassant le seuil configuré.
/// Remonte la pile d'appels pour identifier la méthode repository (<c>{{repository_namespace_prefix}}.*</c>) à l'origine de la requête.
/// </summary>
/// <remarks>
/// <para>
/// <b>Références :</b>
/// <list type="bullet">
///   <item>
///     EF Core interceptors (doc officielle) :
///     <see href="https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors"/>
///   </item>
///   <item>
///     <see cref="DbCommandInterceptor"/> API :
///     <see href="https://learn.microsoft.com/en-us/dotnet/api/microsoft.entityframeworkcore.diagnostics.dbcommandinterceptor"/>
///   </item>
///   <item>
///     Exemple de slow-query interceptor (SO) :
///     <see href="https://medium.com/@sudipdevdev/how-to-detect-and-log-slow-queries-in-entity-framework-core-e2ab71024849"/>
///   </item>
///   <item>
///     <see cref="System.Diagnostics.StackTrace"/> pour remonter l'appelant :
///     <see href="https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.stacktrace"/>
///   </item>
///   <item>
///     Enregistrement via <c>AddInterceptors</c> :
///     <see href="https://learn.microsoft.com/en-us/ef/core/logging-events-diagnostics/interceptors#registering-interceptors"/>
///   </item>
/// </list>
/// </para>
/// </remarks>
public class EfSlowQueryInterceptor : DbCommandInterceptor
{
    private readonly ILogger<EfSlowQueryInterceptor> logger;
    private readonly int seuilMs;

    /// <summary>
    /// Initializes a new instance of the <see cref="EfSlowQueryInterceptor"/> class.
    /// </summary>
    /// <param name="logger">Le service de journalisation injecté pour suivre les opérations de l'intercepteur.</param>
    /// <param name="options">Les options de performance EF injectées pour récupérer le seuil de lenteur configuré.</param>
    public EfSlowQueryInterceptor(ILogger<EfSlowQueryInterceptor> logger, IOptions<EfPerformanceOptions> options)
    {
        this.logger = logger;
        this.seuilMs = options.Value.SeuilMs;

        this.logger.LogDebug("[EfSlowQueryInterceptor] Constructeur appelé — seuil : {SeuilMs} ms.", this.seuilMs);
    }

    /// <inheritdoc/>
    public override DbDataReader ReaderExecuted(DbCommand command, CommandExecutedEventData eventData, DbDataReader result)
    {
        this.JournaliserSiLent(eventData.Duration);
        return result;
    }

    /// <inheritdoc/>
    public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default)
    {
        this.JournaliserSiLent(eventData.Duration);
        return ValueTask.FromResult(result);
    }

    /// <inheritdoc/>
    public override int NonQueryExecuted(DbCommand command, CommandExecutedEventData eventData, int result)
    {
        this.JournaliserSiLent(eventData.Duration);
        return result;
    }

    /// <inheritdoc/>
    public override ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        this.JournaliserSiLent(eventData.Duration);
        return ValueTask.FromResult(result);
    }

    /// <inheritdoc/>
    public override object? ScalarExecuted(DbCommand command, CommandExecutedEventData eventData, object? result)
    {
        this.JournaliserSiLent(eventData.Duration);
        return result;
    }

    /// <inheritdoc/>
    public override ValueTask<object?> ScalarExecutedAsync(DbCommand command, CommandExecutedEventData eventData, object? result, CancellationToken cancellationToken = default)
    {
        this.JournaliserSiLent(eventData.Duration);
        return ValueTask.FromResult(result);
    }

    /// <summary>
    /// Remonte la pile d'appels pour trouver la première méthode dans <c>{{repository_namespace_prefix}}</c>.
    /// Toutes les requêtes EF Core du projet transitent par ce namespace, ce qui garantit
    /// un résultat pertinent sans parcourir l'intégralité de la stack.
    /// </summary>
    /// <returns>Chaîne <c>Classe.Méthode</c> ou <c>"inconnu"</c> si rien trouvé.</returns>
    /// <remarks>
    /// <see cref="StackTrace"/> est instancié uniquement quand le seuil est dépassé,
    /// ce qui évite tout impact sur le chemin nominal.
    /// Ref : <see href="https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.stacktrace"/>.
    /// </remarks>
    private static string TrouverAppelantRepository()
    {
        // skipFrames: 1 pour sauter TrouverAppelantRepository elle-même
        // fNeedFileInfo: false — on ne veut pas les numéros de ligne (coût supplémentaire inutile)
        var frames = new StackTrace(skipFrames: 1, fNeedFileInfo: false).GetFrames();

        foreach (var frame in frames)
        {
            var methode = frame.GetMethod();
            if (methode?.DeclaringType?.Namespace?.StartsWith("{{repository_namespace_prefix}}", StringComparison.Ordinal) == true)
            {
                return $"{methode.DeclaringType.Name}.{methode.Name}";
            }
        }

        return "inconnu";
    }

    private void JournaliserSiLent(TimeSpan duree)
    {
        if (duree.TotalMilliseconds > this.seuilMs)
        {
            var appelant = TrouverAppelantRepository();

            this.logger.LogWarning(
                "[EfSlowQueryInterceptor] Opération EF Core lente détectée — durée réelle : {DureeMs} ms — seuil : {SeuilMs} ms — dépassement : +{Depassement} ms.{NewLine}Appelant : {Appelant}",
                duree.TotalMilliseconds.ToString("F2"),
                this.seuilMs,
                (duree.TotalMilliseconds - this.seuilMs).ToString("F2"),
                Environment.NewLine,
                appelant);
        }
    }
}