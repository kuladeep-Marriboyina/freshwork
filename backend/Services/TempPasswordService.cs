using System.Security.Cryptography;

namespace UWorldFreshdeskCopilot.Services;

// Stands in for "create a temporary password using UWorld". In production this would
// call the UWorld identity system to set the temp password; here we just generate one.
public class TempPasswordService
{
    private const string Upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    private const string Lower = "abcdefghijkmnpqrstuvwxyz";
    private const string Digits = "23456789";
    private const string Special = "!@#$%*";

    public string Generate(int length = 12)
    {
        string all = Upper + Lower + Digits + Special;
        var chars = new char[length];

        // guarantee at least one of each class
        chars[0] = Pick(Upper);
        chars[1] = Pick(Lower);
        chars[2] = Pick(Digits);
        chars[3] = Pick(Special);
        for (int i = 4; i < length; i++)
            chars[i] = Pick(all);

        // Fisher–Yates shuffle with crypto RNG
        for (int i = chars.Length - 1; i > 0; i--)
        {
            int j = RandomNumberGenerator.GetInt32(i + 1);
            (chars[i], chars[j]) = (chars[j], chars[i]);
        }
        return new string(chars);
    }

    private static char Pick(string set) => set[RandomNumberGenerator.GetInt32(set.Length)];
}
