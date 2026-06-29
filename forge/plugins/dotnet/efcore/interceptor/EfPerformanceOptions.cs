namespace {{root_namespace}}.Configuration;

/// <summary>
/// Options de seuil pour la détection des opérations EF Core lentes.
/// </summary>
public class EfPerformanceOptions
{
    /// <summary>
    /// Obtient ou définit le seuil en millisecondes au-delà duquel une commande SQL est journalisée.
    /// Valeur par défaut : {{ seuil_ms }} ms.
    /// </summary>
    public int SeuilMs { get; set; } = {{ seuil_ms }};
}
