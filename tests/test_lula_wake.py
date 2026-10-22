import unittest
from ai_call import detect_wake_word

class LulaWakeTests(unittest.TestCase):
    def test_new_name(self):
        for phrase in ("Ei Lula, resuma a conversa", "Oi Lula resuma a conversa", "Olá Lula resuma a conversa", "e aí Lula resuma a conversa"):
            activated, question = detect_wake_word(phrase)
            self.assertTrue(activated, phrase)
            self.assertEqual(question, "resuma a conversa")

    def test_old_name_no_longer_activates(self):
        for phrase in ("Ei LulaDroid conte", "Ei Lula Droid conte", "conversa sobre lula no mar", "Lulapalooza"):
            self.assertFalse(detect_wake_word(phrase)[0], phrase)
