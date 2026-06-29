namespace {{root_namespace}}.Security;

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

using {{root_namespace}}.Interfaces;

using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

/// <summary>
/// Implémentation de <see cref="ITokenGenerator"/> basée sur <see cref="JwtSecurityTokenHandler"/>.
/// </summary>
public class JwtTokenGenerator : ITokenGenerator
{
    private readonly JwtOptions options;

    public JwtTokenGenerator(IOptions<JwtOptions> options)
    {
        this.options = options.Value;
    }

    /// <inheritdoc/>
    public string GenerateToken(IEnumerable<Claim> claims)
    {
        var keyBytes = Encoding.UTF8.GetBytes(this.options.Key);
        var credentials = new SigningCredentials(new SymmetricSecurityKey(keyBytes), SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: this.options.Issuer,
            audience: this.options.Audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(this.options.ExpiryMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
