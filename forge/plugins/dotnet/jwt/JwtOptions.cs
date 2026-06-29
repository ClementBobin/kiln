namespace {{root_namespace}}.Security;

/// <summary>
/// Options de configuration JWT, liées à la section "Jwt" de appsettings.json.
/// </summary>
public class JwtOptions
{
    /// <summary>Clé secrète utilisée pour signer les tokens (à stocker hors du contrôle de version).</summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>Émetteur attendu (claim "iss").</summary>
    public string Issuer { get; set; } = string.Empty;

    /// <summary>Audience attendue (claim "aud").</summary>
    public string Audience { get; set; } = string.Empty;

    /// <summary>Durée de validité du token, en minutes.</summary>
    public int ExpiryMinutes { get; set; } = 60;
}
