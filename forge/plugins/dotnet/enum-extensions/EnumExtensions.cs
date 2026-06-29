using System.ComponentModel;
using System.Reflection;

namespace {{root_namespace}}.Tools;

public static class EnumExtensions
{
    public static string GetEnumDescription(this Enum value)
    {
        return value
            .GetType()
            .GetField(value.ToString())
            ?.GetCustomAttribute<DescriptionAttribute>()
            ?.Description
            ?? value.ToString();
    }
}
