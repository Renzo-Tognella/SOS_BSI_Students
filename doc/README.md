# Documentação do SaveStudents

Esta pasta centraliza a documentação funcional e técnica do sistema.

## Índice

1. [Visão geral e arquitetura](./01-visao-geral-e-arquitetura.md)
2. [Features por tela](./02-features-por-tela.md)
3. [Cálculos e regras de negócio](./03-calculos-e-regras.md)
4. [APIs e contratos](./04-apis-e-contratos.md)
5. [Dados, catálogos e persistência local](./05-dados-catalogos-e-persistencia.md)

## Objetivo do sistema

O SaveStudents é um dashboard acadêmico para alunos da UTFPR que:

- processa o histórico em PDF;
- calcula progresso por matriz curricular (806/981);
- mostra o que falta por categoria/período;
- ajuda a montar plano de grade com dados reais de oferta (GradeNaHora);
- permite convalidação manual de disciplinas não utilizadas;
- exporta resultado em JSON e PDF.

## Escopo principal desta documentação

- explicar o que cada feature faz;
- explicar exatamente como os cálculos são feitos no código;
- documentar as entradas/saídas das APIs usadas pelo front-end.
