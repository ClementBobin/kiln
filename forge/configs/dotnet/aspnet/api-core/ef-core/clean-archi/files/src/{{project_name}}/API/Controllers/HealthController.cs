using Microsoft.AspNetCore.Mvc;

namespace {{namespace}}.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HealthController : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok(new { status = "healthy", app = "{{project_name}}" });
}
