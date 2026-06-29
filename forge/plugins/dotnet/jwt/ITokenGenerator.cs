namespace {{root_namespace}}.Interfaces;

using System.Security.Claims;

/// <summary>
/// Génère des tokens JWT pour un ensemble de claims donné.
/// </summary>
public interface ITokenGenerator
{
    /// <summary>
    /// Génère un token JWT signé encodant les claims fournis.
    /// </summary>
    /// <param name="claims">Les claims à inclure dans le token (id utilisateur, rôle, ...).</param>
    /// <returns>Le token JWT encodé.</returns>
    string GenerateToken(IEnumerable<Claim> claims);
}
